// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { countRatedToday, loadReviewPlan } from './reviewSessionController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories, type Repositories } from '../../infra/persistence/repositories';
import { DAY_MS } from '../../domain/srs/parameters';
import type { ReviewLogEntry, UserId, WordSchedulingState } from '../../types/domain';

let seq = 0;
async function freshEnv(): Promise<{ repos: Repositories; userId: UserId }> {
  const userId = `rsc_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { repos: createRepositories(db), userId };
}

const NOW = 100 * DAY_MS; // exact UTC midnight

function dueWord(userId: UserId, wordId: string): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: NOW - DAY_MS,
    dueAt: NOW - 1,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
  };
}

function log(userId: UserId, source: ReviewLogEntry['source'], at: number): ReviewLogEntry {
  return { userId, wordId: 'x', rating: 3, source, at };
}

describe('countRatedToday()', () => {
  it('counts review rows since midnight minus offsetting undo rows', async () => {
    const { repos, userId } = await freshEnv();
    await repos.reviewLog.append(log(userId, 'review', NOW));
    await repos.reviewLog.append(log(userId, 'review', NOW + 1));
    await repos.reviewLog.append(log(userId, 'review', NOW + 2));
    await repos.reviewLog.append(log(userId, 'undo', NOW + 3));
    await repos.reviewLog.append(log(userId, 'passage', NOW + 4)); // passive credit — not a review card
    await repos.reviewLog.append(log(userId, 'review', NOW - DAY_MS)); // yesterday — excluded

    expect(await countRatedToday(repos.reviewLog, userId, NOW)).toBe(2); // 3 review − 1 undo
  });

  // Regression (finding #3): the daily budget window must open at the learner's LOCAL midnight, not
  // UTC midnight. JST (tz +540 = +9h) local midnight of UTC-day 100 is 100·DAY − 9h, i.e. it sits
  // in UTC-day 99. Cards graded 23:00 the *previous local evening* (2h before local midnight) are
  // still in the SAME UTC day as 00:10 the new local morning, so a UTC boundary miscounts them as
  // "today" and blocks the fresh local day; the local boundary must exclude them.
  it('opens the daily window at local midnight, not UTC midnight (JST tz +540)', async () => {
    const { repos, userId } = await freshEnv();
    const TZ = 540; // JST minutes east of UTC
    const tzMs = TZ * 60_000; // 9h
    const localMidnight = NOW - tzMs; // local midnight of the new day (lands in the prior UTC day)
    const eveningPrevLocal = localMidnight - 2 * 60 * 60_000; // 23:00 the previous local day
    const justAfterLocalMidnight = localMidnight + 10 * 60_000; // 00:10 the new local day

    for (let i = 0; i < 20; i += 1) await repos.reviewLog.append(log(userId, 'review', eveningPrevLocal + i));

    // Pre-fix behaviour: a UTC boundary (offset 0) leaks all 20 prior-evening cards into "today".
    expect(await countRatedToday(repos.reviewLog, userId, justAfterLocalMidnight)).toBe(20);
    // Fixed behaviour: the local boundary places them in "yesterday" → the new local day starts at 0.
    expect(await countRatedToday(repos.reviewLog, userId, justAfterLocalMidnight, TZ)).toBe(0);
  });

  // Regression (finding #3): the full start-gate path — a JST learner with a backlog exceeding their
  // daily cap must NOT be blocked ("また明日") the instant local midnight passes.
  it('does not flag dailyLimitReached after local midnight for a JST learner at their cap', async () => {
    const { repos, userId } = await freshEnv();
    const TZ = 540;
    const tzMs = TZ * 60_000;
    const localMidnight = NOW - tzMs;
    const eveningPrevLocal = localMidnight - 2 * 60 * 60_000;
    const justAfterLocalMidnight = localMidnight + 10 * 60_000;

    // A backlog larger than the daily cap (the exact scenario a cap targets), all due before "now".
    for (let i = 0; i < 30; i += 1) {
      await repos.scheduling.upsert({ ...dueWord(userId, `w${i}`), dueAt: eveningPrevLocal - DAY_MS });
    }
    // 20 cards graded the previous local evening; the learner's cap is 20.
    for (let i = 0; i < 20; i += 1) await repos.reviewLog.append(log(userId, 'review', eveningPrevLocal + i));

    // Local boundary: the fresh day is unblocked with a full budget.
    const local = await loadReviewPlan(repos, userId, justAfterLocalMidnight, 20, undefined, TZ);
    expect(local.ratedToday).toBe(0);
    expect(local.dailyLimitReached).toBe(false);
    expect(local.sessionSize).toBe(20); // SESSION_REVIEW_LIMIT

    // UTC boundary (the pre-fix bug): still blocked until UTC midnight.
    const utc = await loadReviewPlan(repos, userId, justAfterLocalMidnight, 20);
    expect(utc.ratedToday).toBe(20);
    expect(utc.dailyLimitReached).toBe(true);
    expect(utc.sessionSize).toBe(0);
  });
});

describe('loadReviewPlan() daily ceiling', () => {
  it('caps the session at the remaining daily budget (59 graded → 1 card)', async () => {
    const { repos, userId } = await freshEnv();
    for (let i = 0; i < 5; i += 1) await repos.scheduling.upsert(dueWord(userId, `w${i}`));
    for (let i = 0; i < 59; i += 1) await repos.reviewLog.append(log(userId, 'review', NOW + i));

    const plan = await loadReviewPlan(repos, userId, NOW, 60);
    expect(plan.dueTotal).toBe(5);
    expect(plan.ratedToday).toBe(59);
    expect(plan.dailyRemaining).toBe(1);
    expect(plan.sessionSize).toBe(1);
    expect(plan.queue).toHaveLength(1);
    expect(plan.dailyLimitReached).toBe(false);
  });

  it('flags the ceiling when the day is exhausted', async () => {
    const { repos, userId } = await freshEnv();
    for (let i = 0; i < 3; i += 1) await repos.scheduling.upsert(dueWord(userId, `w${i}`));
    for (let i = 0; i < 60; i += 1) await repos.reviewLog.append(log(userId, 'review', NOW + i));

    const plan = await loadReviewPlan(repos, userId, NOW, 60);
    expect(plan.sessionSize).toBe(0);
    expect(plan.dailyLimitReached).toBe(true);
  });
});

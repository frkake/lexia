// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { applyReviewRating } from './reviewController';
import { loadDashboardSnapshot } from './dashboardController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories, type Repositories } from '../../infra/persistence/repositories';
import { DAY_MS } from '../../domain/srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

let seq = 0;
async function freshEnv(): Promise<{ db: LexiaDb; repos: Repositories; userId: UserId }> {
  const userId = `review_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { db, repos: createRepositories(db), userId };
}

function sched(userId: UserId, wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

function statesReader(db: LexiaDb) {
  return (userId: UserId) => db.scheduling.where('userId').equals(userId).toArray();
}

describe('applyReviewRating (Flow 2 wiring)', () => {
  it('bootstraps a New word, persists the reschedule and appends a review log', async () => {
    const { repos, userId } = await freshEnv();
    const now = 100 * DAY_MS;

    const next = await applyReviewRating(repos, userId, 'fresh', 3, now);

    expect(next.stability).toBeGreaterThan(0);
    expect(next.mastery).toBe('Learning'); // New → Learning on first rating
    const stored = await repos.scheduling.get(userId, 'fresh');
    expect(stored?.dueAt).toBe(next.dueAt);
    const log = await repos.reviewLog.since(userId, 0);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ wordId: 'fresh', rating: 3, source: 'review' });
  });

  it('explicit success past the mastery threshold promotes the stage', async () => {
    const { repos, userId } = await freshEnv();
    const now = 100 * DAY_MS;
    // High, stable, low-lapse word reviewed at its due date → Mastered ceiling.
    await repos.scheduling.upsert(
      sched(userId, 'w1', { stability: 60, difficulty: 4, lapses: 0, lastReviewAt: now - 60 * DAY_MS }),
    );

    const next = await applyReviewRating(repos, userId, 'w1', 3, now);

    expect(next.mastery).toBe('Mastered');
  });

  it('an Again rating records a lapse and logs the review', async () => {
    const { repos, userId } = await freshEnv();
    const now = 50 * DAY_MS;
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 10, lapses: 0, lastReviewAt: now - 10 * DAY_MS }));

    const next = await applyReviewRating(repos, userId, 'w1', 1, now);

    expect(next.lapses).toBe(1);
    const log = await repos.reviewLog.since(userId, 0);
    expect(log[0]).toMatchObject({ rating: 1, source: 'review' });
  });
});

describe('dashboard reflection after a review (Flow 2 → DashboardProjector)', () => {
  it("updates today's due count, breakdown and weekly activity", async () => {
    const { db, repos, userId } = await freshEnv();
    const now = 100 * DAY_MS;
    const deps = { loadStates: statesReader(db), progress: repos.progress, reviewLog: repos.reviewLog, passages: repos.passages };

    // One word due now.
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 4, dueAt: now - DAY_MS }));

    const before = await loadDashboardSnapshot(deps, userId, now);
    expect(before.dueTodayCount).toBe(1);

    // Rate it Easy → due pushed well into the future, a review logged today.
    await applyReviewRating(repos, userId, 'w1', 4, now);

    const after = await loadDashboardSnapshot(deps, userId, now);
    expect(after.dueTodayCount).toBe(0);
    expect(after.mastery.total).toBe(1);
    const todayBucket = after.weekly[after.weekly.length - 1];
    expect(todayBucket?.reviewCount).toBe(1);
  });
});

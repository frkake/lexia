// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { applyReviewRating, markUnknownFromReading, undoReviewRating } from './reviewController';
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

describe('markUnknownFromReading (F-3: reading-time「知らなかった」)', () => {
  it('resets the interval like an Again but logs source=passage (not review)', async () => {
    const { repos, userId } = await freshEnv();
    const now = 50 * DAY_MS;
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 10, lapses: 0, lastReviewAt: now - 10 * DAY_MS }));

    const next = await markUnknownFromReading(repos, userId, 'w1', now);

    // Same SRS effect as applyReviewRating(rating=1): a lapse is recorded.
    expect(next.lapses).toBe(1);
    expect(next.lastSource).toBe('passage');
    const log = await repos.reviewLog.since(userId, 0);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ wordId: 'w1', rating: 1, source: 'passage' });
  });

  it('produces the same reschedule as an explicit Again, differing only in the log source', async () => {
    const now = 50 * DAY_MS;
    const envA = await freshEnv();
    const envB = await freshEnv();
    const seed = (uid: UserId): WordSchedulingState =>
      sched(uid, 'w1', { stability: 12, lapses: 0, lastReviewAt: now - 12 * DAY_MS });
    await envA.repos.scheduling.upsert(seed(envA.userId));
    await envB.repos.scheduling.upsert(seed(envB.userId));

    const viaReview = await applyReviewRating(envA.repos, envA.userId, 'w1', 1, now);
    const viaReading = await markUnknownFromReading(envB.repos, envB.userId, 'w1', now);

    // The scheduling numbers match; only the provenance (lastSource / log source) differs.
    expect(viaReading.stability).toBe(viaReview.stability);
    expect(viaReading.dueAt).toBe(viaReview.dueAt);
    expect(viaReading.lapses).toBe(viaReview.lapses);
    expect(viaReview.lastSource).toBe('review');
    expect(viaReading.lastSource).toBe('passage');
  });

  it('bootstraps a New word and records a passage-origin lapse', async () => {
    const { repos, userId } = await freshEnv();
    const now = 100 * DAY_MS;

    const next = await markUnknownFromReading(repos, userId, 'fresh', now);

    expect(next.stability).toBeGreaterThan(0); // seeded from New then rescheduled
    const log = await repos.reviewLog.since(userId, 0);
    expect(log[0]).toMatchObject({ wordId: 'fresh', rating: 1, source: 'passage' });
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

describe('undoReviewRating (C-5c "1つ戻る")', () => {
  it('restores the pre-rating state and appends an offsetting undo log (append-only)', async () => {
    const { repos, userId } = await freshEnv();
    const now = 100 * DAY_MS;
    const prior = sched(userId, 'w1', { stability: 5, dueAt: now - DAY_MS });
    await repos.scheduling.upsert(prior);

    const rated = await applyReviewRating(repos, userId, 'w1', 3, now);
    expect(rated.dueAt).toBeGreaterThan(now); // rescheduled forward

    await undoReviewRating(repos, prior, 3, now + 1000);

    const restored = await repos.scheduling.get(userId, 'w1');
    expect(restored).toEqual(prior); // exact pre-rating state is back
    const log = await repos.reviewLog.since(userId, 0);
    expect(log).toHaveLength(2); // review row is kept; undo row is appended
    expect(log[0]).toMatchObject({ rating: 3, source: 'review' });
    expect(log[1]).toMatchObject({ rating: 3, source: 'undo' });
  });
});

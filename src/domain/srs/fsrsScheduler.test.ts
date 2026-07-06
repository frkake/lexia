import { describe, it, expect } from 'vitest';
import { fsrs } from './fsrsScheduler';
import { FSRS_DEFAULT_WEIGHTS, FIRST_DISPLAY_LADDER_MS, DAY_MS } from './parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

const ID = { userId: 'u1' as UserId, wordId: 'w1' };

function graduated(over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: ID.userId,
    wordId: ID.wordId,
    stability: 10,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 10 * DAY_MS,
    lastSource: 'review',
    mastery: 'Consolidating',
    reappearCount: 0,
    ...over,
  };
}

describe('FsrsScheduler.initial', () => {
  it('seeds Good with the canonical initial stability w[2] and the 4-day ladder', () => {
    const now = 1_000_000;
    const s = fsrs.initial(3, now, ID);
    expect(s.stability).toBeCloseTo(FSRS_DEFAULT_WEIGHTS[2], 6);
    expect(s.difficulty).toBeGreaterThanOrEqual(1);
    expect(s.difficulty).toBeLessThanOrEqual(10);
    expect(s.reps).toBe(1);
    expect(s.lapses).toBe(0);
    expect(s.lastReviewAt).toBe(now);
    expect(s.dueAt).toBe(now + FIRST_DISPLAY_LADDER_MS[3]);
    expect(s.mastery).not.toBe('New');
  });

  it('seeds Again as a lapse that stays in learning on the 10-minute step', () => {
    const now = 1_000_000;
    const s = fsrs.initial(1, now, ID);
    expect(s.lapses).toBe(1);
    expect(s.learningStep).toBe(1);
    expect(s.dueAt).toBe(now + FIRST_DISPLAY_LADDER_MS[1]);
  });

  it('preserves a New word vocabulary level when bootstrapping the first review', () => {
    const now = 1_000_000;
    const s = fsrs.review(graduated({ stability: undefined, reps: 0, mastery: 'New', level: 'B2' }), 3, now);
    expect(s.level).toBe('B2');
  });

  it('carries seededAt across the first review so the daily new-word cap (C-5b) is not reset', () => {
    const seededAt = 500_000;
    const now = 1_000_000;
    // A freshly-seeded New word: stability undefined, seededAt set at introduction time.
    const seeded = graduated({ stability: undefined, reps: 0, mastery: 'New', seededAt });
    // Both reading-time signals bootstrap through seed(): read_through → Good (3), lookup → Again (1).
    for (const rating of [3, 1] as const) {
      const next = fsrs.review(seeded, rating, now);
      expect(next.seededAt).toBe(seededAt);
    }
    // simulate (drives recallEventService) must preserve it too.
    expect(fsrs.simulate(seeded, 3, now).seededAt).toBe(seededAt);
  });

  it('carries the suspended flag across the first review so a known-declared word is not un-suspended', () => {
    const now = 1_000_000;
    const seeded = graduated({ stability: undefined, reps: 0, mastery: 'New', suspended: true });
    expect(fsrs.review(seeded, 3, now).suspended).toBe(true);
  });
});

describe('FsrsScheduler.retrievability / nextIntervalMs', () => {
  it('R = 1 at review time and ≈ Rd after exactly S days', () => {
    const s = graduated({ stability: 10, lastReviewAt: 0 });
    expect(fsrs.retrievability(s, 0)).toBeCloseTo(1, 6);
    expect(fsrs.retrievability(s, 10 * DAY_MS)).toBeCloseTo(0.9, 2);
  });

  it('next interval at the default retention equals S days', () => {
    const ms = fsrs.nextIntervalMs(graduated({ stability: 10 }));
    expect(Math.abs(ms - 10 * DAY_MS)).toBeLessThan(60_000); // within a minute of 10 days
  });
});

describe('FsrsScheduler.review', () => {
  it('a graduated success satisfies dueAt = now + nextIntervalMs(result) and grows stability', () => {
    const now = 10 * DAY_MS; // elapsed ≈ due
    const res = fsrs.review(graduated(), 3, now);
    expect(res.dueAt).toBe(now + fsrs.nextIntervalMs(res));
    expect(res.stability!).toBeGreaterThan(10);
    expect(res.reps).toBe(4);
    expect(res.lastReviewAt).toBe(now);
    expect(res.lastSource).toBe('review');
    expect(res.learningStep).toBe(0);
  });

  it('higher ratings yield higher resulting stability (Easy ≥ Good ≥ Hard)', () => {
    const now = 10 * DAY_MS;
    const sHard = fsrs.simulate(graduated(), 2, now).stability!;
    const sGood = fsrs.simulate(graduated(), 3, now).stability!;
    const sEasy = fsrs.simulate(graduated(), 4, now).stability!;
    expect(sEasy).toBeGreaterThanOrEqual(sGood);
    expect(sGood).toBeGreaterThanOrEqual(sHard);
  });

  it('a lapse shrinks stability and reschedules on the relearning ladder', () => {
    const now = 10 * DAY_MS;
    const res = fsrs.review(graduated(), 1, now);
    expect(res.stability!).toBeLessThan(10);
    expect(res.lapses).toBe(1);
    expect(res.learningStep).toBe(1);
    expect(res.dueAt).toBe(now + FIRST_DISPLAY_LADDER_MS[1]);
  });
});

describe('FsrsScheduler.simulate', () => {
  it('is non-destructive and agrees with review for the same input', () => {
    const now = 10 * DAY_MS;
    const before = graduated();
    const snapshot = structuredClone(before);
    const sim = fsrs.simulate(before, 3, now);
    expect(before).toEqual(snapshot); // input untouched
    expect(sim).toEqual(fsrs.review(graduated(), 3, now));
  });
});

describe('FsrsScheduler.repsToConsolidate', () => {
  it('returns 0 once stability already exceeds the consolidate threshold', () => {
    expect(fsrs.repsToConsolidate(graduated({ stability: 10 }))).toBe(0);
  });

  it('returns a positive integer count of ideal Good reviews to reach 7 days', () => {
    const n = fsrs.repsToConsolidate(graduated({ stability: 2 }));
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it('handles a New word (no stability) by projecting from the Good initial', () => {
    const fresh = graduated({ stability: undefined as unknown as number, reps: 0, mastery: 'New' });
    delete (fresh as { stability?: number }).stability;
    expect(fsrs.repsToConsolidate(fresh)).toBeGreaterThan(0);
  });
});

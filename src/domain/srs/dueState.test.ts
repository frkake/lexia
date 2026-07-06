import { describe, it, expect } from 'vitest';
import { isDueForReview } from './dueState';
import type { UserId, WordSchedulingState } from '../../types/domain';

const U = 'u1' as UserId;

function sched(over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: U,
    wordId: 'w',
    stability: 5,
    difficulty: 5,
    reps: 1,
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

describe('isDueForReview', () => {
  it('is true for a learned word whose dueAt has arrived', () => {
    expect(isDueForReview(sched({ stability: 5, dueAt: 900 }), 1_000)).toBe(true);
  });

  it('treats dueAt exactly equal to now as due (inclusive boundary)', () => {
    expect(isDueForReview(sched({ stability: 5, dueAt: 1_000 }), 1_000)).toBe(true);
  });

  it('is false for a learned word not yet due', () => {
    expect(isDueForReview(sched({ stability: 5, dueAt: 1_001 }), 1_000)).toBe(false);
  });

  it('is false for a seeded New word (stability undefined) even when dueAt has elapsed', () => {
    const seeded = sched({ dueAt: 0, reps: 0, mastery: 'New' });
    delete seeded.stability;
    expect(isDueForReview(seeded, 1_000)).toBe(false);
  });

  it('is false for a seeded New word whose next-day dueAt is still in the future', () => {
    const seeded = sched({ dueAt: 5_000, reps: 0, mastery: 'New' });
    delete seeded.stability;
    expect(isDueForReview(seeded, 1_000)).toBe(false);
  });

  it('is false for a suspended (known-declared) word even when learned and due (C-5d)', () => {
    expect(isDueForReview(sched({ stability: 5, dueAt: 900, suspended: true }), 1_000)).toBe(false);
  });
});

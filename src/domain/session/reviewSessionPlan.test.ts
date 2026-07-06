// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeReviewPlan, estimatedSessionMinutes } from './reviewSessionPlan';
import { SESSION_REVIEW_LIMIT, DAY_MS } from '../srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

const USER = 'u1' as UserId;
const NOW = 100 * DAY_MS;

function due(wordId: string, dueAt: number, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: USER,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: NOW - DAY_MS,
    dueAt,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

/** A New (seeded, not-yet-learned) word: stability undefined ⇒ never review-due. */
function seeded(wordId: string): WordSchedulingState {
  return due(wordId, NOW - DAY_MS, { stability: undefined, mastery: 'New' });
}

describe('computeReviewPlan()', () => {
  it('excludes seeded New words and orders due-soonest first', () => {
    const states = [due('b', NOW - 1), due('a', NOW - 10), seeded('new1'), due('c', NOW + DAY_MS)];
    const plan = computeReviewPlan(states, NOW, 0, 60);
    expect(plan.queue.map((s) => s.wordId)).toEqual(['a', 'b']); // c not yet due, new1 excluded
    expect(plan.dueTotal).toBe(2);
    expect(plan.upcomingCount).toBe(1); // c becomes due within the day
    expect(plan.empty).toBe(false);
    expect(plan.dailyLimitReached).toBe(false);
  });

  it('caps the queue at SESSION_REVIEW_LIMIT', () => {
    const states = Array.from({ length: SESSION_REVIEW_LIMIT + 5 }, (_, i) => due(`w${i}`, NOW - (100 - i)));
    const plan = computeReviewPlan(states, NOW, 0, 200);
    expect(plan.sessionSize).toBe(SESSION_REVIEW_LIMIT);
    expect(plan.queue).toHaveLength(SESSION_REVIEW_LIMIT);
    expect(plan.dueTotal).toBe(SESSION_REVIEW_LIMIT + 5);
  });

  it('respects the remaining daily budget (59 graded → 1 card of many due)', () => {
    const states = Array.from({ length: 10 }, (_, i) => due(`w${i}`, NOW - (100 - i)));
    const plan = computeReviewPlan(states, NOW, 59, 60);
    expect(plan.dailyRemaining).toBe(1);
    expect(plan.sessionSize).toBe(1);
    expect(plan.dailyLimitReached).toBe(false);
  });

  it('flags the daily ceiling when it is reached and words remain', () => {
    const states = [due('a', NOW - 1), due('b', NOW - 2)];
    const plan = computeReviewPlan(states, NOW, 60, 60);
    expect(plan.dailyRemaining).toBe(0);
    expect(plan.sessionSize).toBe(0);
    expect(plan.queue).toHaveLength(0);
    expect(plan.dailyLimitReached).toBe(true);
  });

  it('reports an empty session when nothing is due (ceiling not "reached")', () => {
    const plan = computeReviewPlan([seeded('n1'), due('c', NOW + DAY_MS)], NOW, 0, 60);
    expect(plan.empty).toBe(true);
    expect(plan.dailyLimitReached).toBe(false);
  });

  it('excludes a suspended learned word from upcomingCount (「もう覚えた」never resurfaces)', () => {
    // A learned word suspended via「もう覚えた（復習から外す）」keeps its stability & near-future dueAt,
    // so dueBefore(now+DAY) still returns it — but it must not be counted as「次の復習は明日 N 語」.
    const suspended = due('gone', NOW + DAY_MS / 2, { suspended: true });
    const plan = computeReviewPlan([suspended], NOW, 0, 60);
    expect(plan.empty).toBe(true);
    expect(plan.dueTotal).toBe(0);
    expect(plan.upcomingCount).toBe(0); // not「次の復習は明日 1 語」for a word removed from review
  });

  it('filters to a given word set (/review?words=)', () => {
    const states = [due('a', NOW - 3), due('b', NOW - 2), due('c', NOW - 1)];
    const plan = computeReviewPlan(states, NOW, 0, 60, ['a', 'c']);
    expect(plan.queue.map((s) => s.wordId)).toEqual(['a', 'c']);
    expect(plan.dueTotal).toBe(2);
  });
});

describe('estimatedSessionMinutes()', () => {
  it('rounds up 15s/card and floors at 1 minute', () => {
    expect(estimatedSessionMinutes(0)).toBe(0);
    expect(estimatedSessionMinutes(1)).toBe(1); // 15s → 1 min
    expect(estimatedSessionMinutes(4)).toBe(1); // 60s → 1 min
    expect(estimatedSessionMinutes(20)).toBe(5); // 300s → 5 min
  });
});

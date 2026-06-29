import { describe, it, expect } from 'vitest';
import { recallEventService } from './recallEventService';
import { fsrs } from './fsrsScheduler';
import { PASSIVE_RECALL_DECAY, DAILY_COOLDOWN_MS, DAY_MS } from './parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

function st(over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: 'u1' as UserId,
    wordId: 'w1',
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

const { apply } = recallEventService;

describe('RecallEventService.apply', () => {
  it('maps a tap-free read-through to a damped Good update, logged as a passage event', () => {
    const state = st({ stability: 6, mastery: 'Learning' });
    const at = 5 * DAY_MS;
    const sGood = fsrs.simulate(state, 3, at).stability!;
    const expected = 6 + PASSIVE_RECALL_DECAY * (sGood - 6);

    const { next, logEntry } = apply(state, { kind: 'read_through', wordId: 'w1', at }, null);

    expect(next.stability).toBeCloseTo(expected, 6);
    expect(next.stability!).toBeGreaterThan(6); // strengthened…
    expect(next.stability!).toBeLessThan(sGood); // …but less than a full Good
    expect(next.lastSource).toBe('passage');
    expect(next.reappearCount).toBe(1);
    expect(logEntry).not.toBeNull();
    expect(logEntry?.source).toBe('passage');
    expect(logEntry?.rating).toBe(3);
    expect(logEntry?.stabilityAfter).toBeCloseTo(expected, 6);
  });

  it('never promotes the mastery stage from a passage recall, even when S crosses a threshold', () => {
    const state = st({ stability: 6, mastery: 'Learning' });
    const { next } = apply(state, { kind: 'read_through', wordId: 'w1', at: 5 * DAY_MS }, null);
    expect(next.stability!).toBeGreaterThan(7); // would qualify for Consolidating…
    expect(next.mastery).toBe('Learning'); // …but passage recall doesn't promote
  });

  it('maps a lookup tap to an Again lapse', () => {
    const state = st({ stability: 10 });
    const { next, logEntry } = apply(state, { kind: 'lookup', wordId: 'w1', at: 10 * DAY_MS }, null);
    expect(next.stability!).toBeLessThan(10);
    expect(next.lapses).toBe(1);
    expect(next.lastSource).toBe('passage');
    expect(logEntry?.rating).toBe(1);
    expect(logEntry?.source).toBe('passage');
  });

  it('suppresses a second same-day passage update (daily cooldown → logEntry null, no change)', () => {
    const state = st({ stability: 6, mastery: 'Learning' });
    const t0 = 5 * DAY_MS;

    const first = apply(state, { kind: 'read_through', wordId: 'w1', at: t0 }, null);
    expect(first.logEntry).not.toBeNull();

    const second = apply(state, { kind: 'read_through', wordId: 'w1', at: t0 + 3_600_000 }, t0);
    expect(second.logEntry).toBeNull();
    expect(second.next).toEqual(state); // unchanged

    const third = apply(state, { kind: 'read_through', wordId: 'w1', at: t0 + DAILY_COOLDOWN_MS + 1 }, t0);
    expect(third.logEntry).not.toBeNull(); // cooldown elapsed
  });

  it('does not mutate the input state', () => {
    const state = st({ stability: 6, mastery: 'Learning' });
    const snapshot = structuredClone(state);
    apply(state, { kind: 'read_through', wordId: 'w1', at: 5 * DAY_MS }, null);
    expect(state).toEqual(snapshot);
  });
});

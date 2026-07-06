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

  it('suppresses a read-through within the cooldown of a same-day EXPLICIT review (cross-source, C-5d)', () => {
    // A word rated「知らなかった」at t0 (its lastUpdate). A read-through fired on completion an hour
    // later must not overwrite that lapse's schedule — the cross-source cooldown suppresses it.
    const state = st({ stability: 4, lapses: 1, learningStep: 1 });
    const t0 = 5 * DAY_MS;
    const readThrough = apply(state, { kind: 'read_through', wordId: 'w1', at: t0 + 3_600_000 }, t0);
    expect(readThrough.logEntry).toBeNull();
    expect(readThrough.next).toEqual(state); // the lapse's 10-minute step survives to completion
  });

  it('preserves seededAt on a freshly-seeded New word so reading defeats no daily new-word cap (C-5b)', () => {
    // A New word woven into a passage: stability undefined, seededAt stamped at generation time.
    const seededAt = 2 * DAY_MS;
    const at = 3 * DAY_MS;
    const seeded = st({ stability: undefined, reps: 0, mastery: 'New', seededAt });
    // Both reading-time interactions bootstrap through fsrs.seed(): read_through and lookup.
    for (const kind of ['read_through', 'lookup'] as const) {
      const { next } = apply(seeded, { kind, wordId: 'w1', at }, null);
      expect(next.seededAt).toBe(seededAt); // introduction timestamp survives → countSeededSince intact
    }
  });

  it('does not mutate the input state', () => {
    const state = st({ stability: 6, mastery: 'Learning' });
    const snapshot = structuredClone(state);
    apply(state, { kind: 'read_through', wordId: 'w1', at: 5 * DAY_MS }, null);
    expect(state).toEqual(snapshot);
  });
});

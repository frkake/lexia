import { describe, it, expect } from 'vitest';
import { newSchedulingState } from './newState';
import { DAY_MS } from '../../domain/srs/parameters';
import type { UserId } from '../../types/domain';

const U = 'u1' as UserId;

describe('newSchedulingState', () => {
  it('is a New placeholder (stability undefined ⇒ New) with legacy dueAt 0 when now is omitted', () => {
    const s = newSchedulingState(U, 'deal');
    expect(s.stability).toBeUndefined();
    expect(s.mastery).toBe('New');
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(0);
    expect(s.lastSource).toBe('passage');
    expect(s.dueAt).toBe(0);
  });

  it('seeds dueAt = now + 1 day so a merely-read word re-surfaces next day, not immediately (A-1-2)', () => {
    const now = 1_000_000;
    const s = newSchedulingState(U, 'deal', now);
    expect(s.dueAt).toBe(now + DAY_MS);
    // Still New: stability undefined ⇒ never enters the /review recall queue (design decision D1).
    expect(s.stability).toBeUndefined();
    expect(s.reps).toBe(0);
    expect(s.mastery).toBe('New');
  });

  it('treats now = 0 as a real timestamp (dueAt = DAY_MS), distinct from the omitted case', () => {
    expect(newSchedulingState(U, 'deal', 0).dueAt).toBe(DAY_MS);
  });
});

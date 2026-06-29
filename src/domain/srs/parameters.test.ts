import { describe, it, expect } from 'vitest';
import {
  FSRS_DEFAULT_WEIGHTS,
  DESIRED_RETENTION,
  S_CONSOLIDATE,
  S_MASTER,
  FIRST_DISPLAY_LADDER_MS,
  PASSIVE_RECALL_DECAY,
  DAILY_COOLDOWN_MS,
  CEFR_OUT_OF_BAND_TOLERANCE,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
} from './parameters';

describe('learning parameters', () => {
  it('FSRS-6 ships exactly 21 default weights w[0..20]', () => {
    expect(FSRS_DEFAULT_WEIGHTS).toHaveLength(21);
    expect(FSRS_DEFAULT_WEIGHTS.every((w) => Number.isFinite(w))).toBe(true);
    // w[0..3] are the per-grade initial stabilities and must be ascending.
    const [again, hard, good, easy] = FSRS_DEFAULT_WEIGHTS;
    expect(again).toBeLessThan(hard);
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it('desired retention Rd is 0.90 within the open unit interval', () => {
    expect(DESIRED_RETENTION).toBe(0.9);
    expect(DESIRED_RETENTION).toBeGreaterThan(0);
    expect(DESIRED_RETENTION).toBeLessThan(1);
  });

  it('stage thresholds are 7d consolidate < 30d master', () => {
    expect(S_CONSOLIDATE).toBe(7);
    expect(S_MASTER).toBe(30);
    expect(S_CONSOLIDATE).toBeLessThan(S_MASTER);
  });

  it('first-display ladder is Again 10m / Hard 1d / Good 4d / Easy 10d, strictly ascending', () => {
    expect(FIRST_DISPLAY_LADDER_MS[1]).toBe(10 * MINUTE_MS);
    expect(FIRST_DISPLAY_LADDER_MS[2]).toBe(1 * DAY_MS);
    expect(FIRST_DISPLAY_LADDER_MS[3]).toBe(4 * DAY_MS);
    expect(FIRST_DISPLAY_LADDER_MS[4]).toBe(10 * DAY_MS);
    expect(FIRST_DISPLAY_LADDER_MS[1]).toBeLessThan(FIRST_DISPLAY_LADDER_MS[2]);
    expect(FIRST_DISPLAY_LADDER_MS[2]).toBeLessThan(FIRST_DISPLAY_LADDER_MS[3]);
    expect(FIRST_DISPLAY_LADDER_MS[3]).toBeLessThan(FIRST_DISPLAY_LADDER_MS[4]);
  });

  it('time unit constants compose correctly', () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(60 * MINUTE_MS);
    expect(DAY_MS).toBe(24 * HOUR_MS);
  });

  it('unvalidated product constants have sane bounds', () => {
    expect(PASSIVE_RECALL_DECAY).toBe(0.5);
    expect(PASSIVE_RECALL_DECAY).toBeGreaterThan(0);
    expect(PASSIVE_RECALL_DECAY).toBeLessThan(1);
    expect(DAILY_COOLDOWN_MS).toBe(DAY_MS);
    expect(CEFR_OUT_OF_BAND_TOLERANCE).toBeGreaterThan(0);
    expect(CEFR_OUT_OF_BAND_TOLERANCE).toBeLessThan(1);
  });
});

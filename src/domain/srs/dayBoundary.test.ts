import { describe, it, expect } from 'vitest';
import { startOfLocalDay } from './dayBoundary';
import { DAY_MS } from './parameters';

describe('startOfLocalDay()', () => {
  const NOON_UTC = 100 * DAY_MS + 12 * 60 * 60_000; // 12:00 UTC on UTC-day 100

  it('floors to UTC midnight with the default (0) offset', () => {
    expect(startOfLocalDay(NOON_UTC)).toBe(100 * DAY_MS);
    expect(startOfLocalDay(NOON_UTC, 0)).toBe(100 * DAY_MS);
    // Just before UTC midnight of the next day still buckets into the current UTC day.
    expect(startOfLocalDay(101 * DAY_MS - 1)).toBe(100 * DAY_MS);
  });

  it('shifts the boundary to the learner’s local midnight for an east-of-UTC offset (JST +540)', () => {
    const TZ = 540; // JST
    const tzMs = TZ * 60_000; // 9h
    const localMidnight = 100 * DAY_MS - tzMs; // JST midnight lands in the prior UTC day
    // 00:10 JST buckets into the JST day that starts at `localMidnight`…
    expect(startOfLocalDay(localMidnight + 10 * 60_000, TZ)).toBe(localMidnight);
    // …while the same instant under a UTC boundary would bucket a full day earlier.
    expect(startOfLocalDay(localMidnight + 10 * 60_000, 0)).not.toBe(localMidnight);
    // 23:59 JST (just before the NEXT local midnight) is still the same local day.
    expect(startOfLocalDay(localMidnight + DAY_MS - 60_000, TZ)).toBe(localMidnight);
    // The instant of local midnight buckets onto itself.
    expect(startOfLocalDay(localMidnight, TZ)).toBe(localMidnight);
  });

  it('handles a west-of-UTC offset (e.g. −300, US Eastern)', () => {
    const TZ = -300; // UTC−5
    const tzMs = TZ * 60_000; // −5h
    const localMidnight = 100 * DAY_MS - tzMs; // = 100·DAY + 5h (in UTC-day 100)
    expect(startOfLocalDay(localMidnight, TZ)).toBe(localMidnight);
    expect(startOfLocalDay(localMidnight + 60_000, TZ)).toBe(localMidnight);
    // 04:59 local (before local midnight rolled) still belongs to the previous local day.
    expect(startOfLocalDay(localMidnight - 60_000, TZ)).toBe(localMidnight - DAY_MS);
  });
});

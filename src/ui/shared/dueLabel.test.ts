import { describe, it, expect } from 'vitest';
import { dueLabel, isDueToday, localDayStart } from './dueLabel';

const DAY = 24 * 60 * 60 * 1000;
// Mid-morning local time so a +/- few hours never crosses a day boundary in the runner's tz.
const NOW = new Date(2026, 6, 6, 10, 0, 0).getTime();

describe('dueLabel', () => {
  it('labels today / past as「今日」', () => {
    expect(dueLabel(NOW, NOW)).toBe('今日');
    expect(dueLabel(NOW - 3 * DAY, NOW)).toBe('今日');
    // Earlier the same local day still reads「今日」.
    expect(dueLabel(new Date(2026, 6, 6, 1, 0, 0).getTime(), NOW)).toBe('今日');
  });

  it('labels the next local day「明日」', () => {
    expect(dueLabel(new Date(2026, 6, 7, 9, 0, 0).getTime(), NOW)).toBe('明日');
  });

  it('labels further-out days as M/D', () => {
    expect(dueLabel(new Date(2026, 6, 12, 9, 0, 0).getTime(), NOW)).toBe('7/12');
    expect(dueLabel(new Date(2026, 11, 1, 9, 0, 0).getTime(), NOW)).toBe('12/1');
  });
});

describe('isDueToday', () => {
  it('is true for today or earlier, false for the future', () => {
    expect(isDueToday(NOW, NOW)).toBe(true);
    expect(isDueToday(NOW - DAY, NOW)).toBe(true);
    expect(isDueToday(new Date(2026, 6, 7, 9, 0, 0).getTime(), NOW)).toBe(false);
  });
});

describe('localDayStart', () => {
  it('floors to local midnight', () => {
    expect(localDayStart(NOW)).toBe(new Date(2026, 6, 6, 0, 0, 0, 0).getTime());
  });
});

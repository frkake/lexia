/**
 * L4 — shared relative-due labelling. Extracted from DashboardScreen so the wordbook list
 * (D-3) and the word detail card reuse the identical「今日 / 明日 / M/D」formatting instead of
 * re-deriving it. Bucketing is by the viewer's LOCAL day (F-4), matching the dashboard.
 */

import { DAY_MS } from '../../domain/srs/parameters';

/** Local-day midnight for the viewer's timezone (F-4). */
export function localDayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Relative day label for a due timestamp (今日 / 明日 / M/D), in the viewer's local day. */
export function dueLabel(dueAt: number, now: number): string {
  const diff = Math.round((localDayStart(dueAt) - localDayStart(now)) / DAY_MS);
  if (diff <= 0) return '今日';
  if (diff === 1) return '明日';
  const d = new Date(dueAt);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Whether a due timestamp lands today or earlier (drives the terracotta「今日」emphasis). */
export function isDueToday(dueAt: number, now: number): boolean {
  return localDayStart(dueAt) <= localDayStart(now);
}

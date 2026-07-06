/**
 * L1 — the single "start of the learner's day" rule shared by every per-day bucketing surface (F-4).
 *
 * `startOfLocalDay(now, tzOffsetMinutes)` returns the epoch-ms midnight of the LOCAL calendar day
 * containing `now`. East of UTC is positive (JST = +540, the value `-new Date().getTimezoneOffset()`
 * yields there). With the default offset 0 it degrades to UTC midnight
 * (`floor(now / DAY_MS) * DAY_MS`), keeping offset-unaware callers deterministic under test.
 *
 * Three surfaces bucket "today" and MUST agree on where it starts:
 *  - the dashboard streak / weekly window (`dashboardProjector`),
 *  - the daily review budget (`reviewSessionController.countRatedToday`, C-5c),
 *  - the daily new-word cap (`wordSuggestionService`, C-5b).
 * They all call THIS function, so the day boundary can never drift between them again (the pre-F-4
 * regression: the dashboard rolled at local midnight while the review / new-word budgets still reset
 * at UTC midnight, blocking a non-UTC learner's fresh local day until UTC midnight).
 */

import { DAY_MS, MINUTE_MS } from './parameters';

/** Epoch-ms midnight of the local day containing `now` (default offset 0 ⇒ UTC midnight). */
export function startOfLocalDay(now: number, tzOffsetMinutes = 0): number {
  const tzOffsetMs = tzOffsetMinutes * MINUTE_MS;
  return Math.floor((now + tzOffsetMs) / DAY_MS) * DAY_MS - tzOffsetMs;
}

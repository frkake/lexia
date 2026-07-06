/**
 * L3 — reviewSessionController: the async glue that turns the repositories into a `ReviewSessionPlan`
 * for the /review start gate (C-5c). It fetches the due words and today's grading tally, then defers
 * all sizing to the pure `computeReviewPlan`. The tally is `source==='review'` rows since the start
 * of the learner's LOCAL day minus offsetting `source==='undo'` rows, so an undone rating returns its
 * daily slot. The day boundary comes from the shared `startOfLocalDay` helper — the SAME rule the
 * dashboard buckets streak/weekly by (F-4) — so the review budget resets at the learner's local
 * midnight, not UTC midnight (see dayBoundary.ts for the pre-F-4 regression this prevents).
 */

import { computeReviewPlan, type ReviewSessionPlan } from '../../domain/session/reviewSessionPlan';
import { DAY_MS } from '../../domain/srs/parameters';
import { startOfLocalDay } from '../../domain/srs/dayBoundary';
import type { ReviewLogRepository, SchedulingRepository } from '../../types/ports';
import type { UserId } from '../../types/domain';

/**
 * Review cards graded so far today: `count(source==='review') − count(source==='undo')`, floored at 0.
 * "Today" starts at the learner's local midnight — pass `tzOffsetMinutes` (east of UTC positive,
 * `-new Date().getTimezoneOffset()`); it defaults to 0 (UTC) for offset-unaware callers/tests.
 */
export async function countRatedToday(
  reviewLog: ReviewLogRepository,
  userId: UserId,
  now: number,
  tzOffsetMinutes = 0,
): Promise<number> {
  const log = await reviewLog.since(userId, startOfLocalDay(now, tzOffsetMinutes));
  let reviews = 0;
  let undos = 0;
  for (const e of log) {
    if (e.source === 'review') reviews += 1;
    else if (e.source === 'undo') undos += 1;
  }
  return Math.max(0, reviews - undos);
}

export interface ReviewPlanDeps {
  scheduling: SchedulingRepository;
  reviewLog: ReviewLogRepository;
}

/**
 * Load the sized review session plan for the start gate. `tzOffsetMinutes` (east of UTC positive,
 * `-new Date().getTimezoneOffset()`) sets the learner's local-midnight boundary for the daily review
 * budget so it resets in step with the dashboard's local day (F-4); it defaults to 0 (UTC).
 */
export async function loadReviewPlan(
  deps: ReviewPlanDeps,
  userId: UserId,
  now: number,
  dailyLimit: number,
  wordFilter?: readonly string[],
  tzOffsetMinutes = 0,
): Promise<ReviewSessionPlan> {
  // Fetch a full day ahead so `computeReviewPlan` can also count words that become due tomorrow
  // (the empty-state「次の復習は明日 N 語」hint) from the same query.
  const [windowStates, ratedToday] = await Promise.all([
    deps.scheduling.dueBefore(userId, now + DAY_MS),
    countRatedToday(deps.reviewLog, userId, now, tzOffsetMinutes),
  ]);
  return computeReviewPlan(windowStates, now, ratedToday, dailyLimit, wordFilter);
}

/**
 * L1 — reviewSessionPlan: the pure load-control math behind the review start-gate (C-5c). Given the
 * learner's due words and how many cards they have already graded today, it decides how big THIS
 * session may be — `min(SESSION_REVIEW_LIMIT, DAILY_REVIEW_LIMIT − 当日評定数)` — and reports the
 * numbers the confirmation screen shows (total due, session size, remaining daily budget, whether
 * the daily ceiling is already reached). No I/O: the controller feeds it the fetched states + tally.
 */

import { isDueForReview } from '../srs/dueState';
import { SESSION_REVIEW_LIMIT, DAY_MS } from '../srs/parameters';
import type { WordSchedulingState } from '../../types/domain';

/** Initial per-card time estimate (seconds) until a real median is available from the ReviewLog. */
export const REVIEW_SECONDS_PER_CARD = 15;

export interface ReviewSessionPlan {
  /** The cards to show this session, due-soonest first (already capped). */
  queue: WordSchedulingState[];
  /** All words currently due for review (after the optional word filter), regardless of the cap. */
  dueTotal: number;
  /** Cards already graded today (source==='review' minus offsetting 'undo' rows). */
  ratedToday: number;
  /** Effective per-day ceiling in force (settings override or the policy default). */
  dailyLimit: number;
  /** Cards still allowed today: `max(0, dailyLimit − ratedToday)`. */
  dailyRemaining: number;
  /** The size of `queue` (== `min(SESSION_REVIEW_LIMIT, dailyRemaining, dueTotal)`). */
  sessionSize: number;
  /** Learned words that become due within the next day but are NOT due yet ("次の復習は明日 N 語"). */
  upcomingCount: number;
  /** True when there is nothing due at all (empty-queue completion state). */
  empty: boolean;
  /** True when words are due but today's ceiling is exhausted (start disabled; "また明日"). */
  dailyLimitReached: boolean;
}

/**
 * Pure session sizing. `states` should be the scheduling rows due within the next day (as returned
 * by `dueBefore(now + DAY_MS)`); the New / seeded words are filtered out here with the same
 * `isDueForReview` predicate the dashboard uses, so the confirmation screen's counts and the /review
 * queue can only differ by the cap. Rows due later than `now` (but within the day) feed `upcomingCount`.
 */
export function computeReviewPlan(
  states: WordSchedulingState[],
  now: number,
  ratedToday: number,
  dailyLimit: number,
  wordFilter?: readonly string[],
): ReviewSessionPlan {
  const filter = wordFilter && wordFilter.length > 0 ? new Set(wordFilter) : undefined;
  const inFilter = (s: WordSchedulingState): boolean => !filter || filter.has(s.wordId);

  const due = states
    .filter((s) => isDueForReview(s, now) && inFilter(s))
    .sort((a, b) => a.dueAt - b.dueAt);

  const upcomingCount = states.filter(
    (s) =>
      !s.suspended &&
      s.stability !== undefined &&
      s.dueAt > now &&
      s.dueAt <= now + DAY_MS &&
      inFilter(s),
  ).length;

  const dueTotal = due.length;
  const dailyRemaining = Math.max(0, dailyLimit - ratedToday);
  const sessionSize = Math.min(SESSION_REVIEW_LIMIT, dailyRemaining, dueTotal);
  const queue = due.slice(0, sessionSize);

  return {
    queue,
    dueTotal,
    ratedToday,
    dailyLimit,
    dailyRemaining,
    sessionSize,
    upcomingCount,
    empty: dueTotal === 0,
    dailyLimitReached: dueTotal > 0 && dailyRemaining === 0,
  };
}

/** Rounded-up minute estimate for a session of `cardCount` cards (confirmation screen). */
export function estimatedSessionMinutes(cardCount: number): number {
  if (cardCount <= 0) return 0;
  return Math.max(1, Math.ceil((cardCount * REVIEW_SECONDS_PER_CARD) / 60));
}

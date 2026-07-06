/**
 * L1 — the canonical "due for review" predicate (C-5b / design decision D1).
 *
 * D1 defines "due" with two faces to stop the home count and the /review queue from diverging
 * (issue 4). This module owns the REVIEW face: a word is due for an explicit recall review only
 * when it has been learned at least once (`stability !== undefined`) AND its next-review time has
 * arrived (`dueAt <= now`). A freshly-seeded New word (stability undefined) is NEVER review-due,
 * whatever its `dueAt` — it re-surfaces only as a generation re-weaving candidate (the "dueAt
 * elapsed" face, applied inside wordSuggestionService), never in the recall queue.
 *
 * `sessionPlanner.planReviewQueue`, `dashboardProjector.dueTodayCount` and `wordSuggestionService`
 * all read THIS predicate, so the numbers they show can only differ by the session cap
 * (`SESSION_REVIEW_LIMIT`), never by definition.
 *
 * A `suspended` word (C-5d「もう覚えた」) is never review-due whatever its stability/dueAt — the
 * learner has declared it known, so it leaves the queue, the home count and the re-weaving pool.
 */

import type { WordSchedulingState } from '../../types/domain';

/**
 * True when `state` is a learned word whose review time has arrived (stability set & dueAt ≤ now) and
 * it has not been suspended as a known word (C-5d).
 */
export function isDueForReview(state: WordSchedulingState, now: number): boolean {
  return !state.suspended && state.stability !== undefined && state.dueAt <= now;
}

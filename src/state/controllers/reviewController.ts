/**
 * L3 — reviewController: wires an explicit review rating into the SRS (design.md Flow 2,
 * task 10.3). Rating a word in the ReviewSession runs:
 *   read state (seed New if absent) → FsrsScheduler.review (reschedule S/D/dueAt) →
 *   MasteryProjector.deriveMastery with the explicit-review event (the only path that may
 *   promote a stage) → persist the new WordSchedulingState and append a `source='review'`
 *   ReviewLog entry. The DashboardProjector re-projection (loadDashboardSnapshot) then
 *   reflects the change in today's due count, the breakdown and weekly activity.
 */

import { fsrs, type FsrsScheduler } from '../../domain/srs/fsrsScheduler';
import { masteryProjector, type MasteryProjector } from '../../domain/srs/masteryProjector';
import { newSchedulingState } from './newState';
import type { SchedulingRepository, ReviewLogRepository } from '../../types/ports';
import type { Rating, UserId, WordSchedulingState } from '../../types/domain';

export interface ReviewControllerDeps {
  scheduling: SchedulingRepository;
  reviewLog: ReviewLogRepository;
  /** Defaults to the singleton FsrsScheduler. */
  scheduler?: FsrsScheduler;
  /** Defaults to the singleton MasteryProjector. */
  projector?: MasteryProjector;
}

export async function applyReviewRating(
  deps: ReviewControllerDeps,
  userId: UserId,
  wordId: string,
  rating: Rating,
  now: number,
): Promise<WordSchedulingState> {
  const scheduler = deps.scheduler ?? fsrs;
  const projector = deps.projector ?? masteryProjector;

  const prior = (await deps.scheduling.get(userId, wordId)) ?? newSchedulingState(userId, wordId, now);
  const rescheduled = scheduler.review(prior, rating, now);
  const mastery = projector.deriveMastery(rescheduled, { kind: 'review', rating });
  const next: WordSchedulingState = { ...rescheduled, mastery };

  await deps.scheduling.upsert(next);
  await deps.reviewLog.append({
    userId,
    wordId,
    rating,
    source: 'review',
    at: now,
    ...(next.stability !== undefined ? { stabilityAfter: next.stability } : {}),
  });

  return next;
}

/**
 * Reading-time「知らなかった」(F-3): the learner marks a word unknown while reading. The SRS effect
 * is identical to an explicit Again (rating 1 reschedule — same interval reset), but the event is
 * recorded with `source='passage'` (and denormalized `lastSource='passage'`) so that reading-time
 * miss-marks count as reading activity, never inflating the weekly「復習」series nor masquerading as
 * an explicit review. Mastery uses the passage event (a rating-1 grade never promotes regardless).
 */
export async function markUnknownFromReading(
  deps: Pick<ReviewControllerDeps, 'scheduling' | 'reviewLog' | 'scheduler' | 'projector'>,
  userId: UserId,
  wordId: string,
  now: number,
): Promise<WordSchedulingState> {
  const scheduler = deps.scheduler ?? fsrs;
  const projector = deps.projector ?? masteryProjector;

  const prior = (await deps.scheduling.get(userId, wordId)) ?? newSchedulingState(userId, wordId, now);
  const rescheduled = scheduler.review(prior, 1, now);
  const mastery = projector.deriveMastery(rescheduled, { kind: 'passage' });
  const next: WordSchedulingState = { ...rescheduled, lastSource: 'passage', mastery };

  await deps.scheduling.upsert(next);
  await deps.reviewLog.append({
    userId,
    wordId,
    rating: 1,
    source: 'passage',
    at: now,
    ...(next.stability !== undefined ? { stabilityAfter: next.stability } : {}),
  });

  return next;
}

/**
 * Undo the most recent rating (C-5c "1つ戻る"; the single shared Undo mechanism referenced by the
 * toast/session Undo affordance). Restores the exact pre-rating `WordSchedulingState` and appends an
 * offsetting `source:'undo'` ReviewLog row (carrying the undone rating) rather than deleting the
 * original `review` row, so the log stays append-only and FSRS-replayable while the day's review
 * tally nets back down. Idempotent at the data layer: re-running with the same prior state is a
 * no-op reschedule plus one more audit row.
 */
export async function undoReviewRating(
  deps: Pick<ReviewControllerDeps, 'scheduling' | 'reviewLog'>,
  priorState: WordSchedulingState,
  ratingUndone: Rating,
  now: number,
): Promise<void> {
  await deps.scheduling.upsert(priorState);
  await deps.reviewLog.append({
    userId: priorState.userId,
    wordId: priorState.wordId,
    rating: ratingUndone,
    source: 'undo',
    at: now,
    ...(priorState.stability !== undefined ? { stabilityAfter: priorState.stability } : {}),
  });
}

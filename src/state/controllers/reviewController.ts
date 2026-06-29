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

  const prior = (await deps.scheduling.get(userId, wordId)) ?? newSchedulingState(userId, wordId);
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

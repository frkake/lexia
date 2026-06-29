/**
 * L3 — newSchedulingState: the canonical "New" (not-yet-learned) WordSchedulingState
 * used by the wiring controllers when a target word has no scheduling row yet. A New
 * word has `stability === undefined`; the FSRS scheduler bootstraps the real S/D on the
 * first rating (see `applyReview`'s New path), so the placeholder difficulty is inert.
 */

import type { UserId, WordSchedulingState } from '../../types/domain';

/** A fresh, unlearned scheduling state (stability undefined ⇒ New). */
export function newSchedulingState(userId: UserId, wordId: string): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: undefined,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'passage',
    mastery: 'New',
    reappearCount: 0,
  };
}

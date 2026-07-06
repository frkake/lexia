/**
 * L3 — newSchedulingState: the canonical "New" (not-yet-learned) WordSchedulingState
 * used by the wiring controllers when a target word has no scheduling row yet. A New
 * word has `stability === undefined`; the FSRS scheduler bootstraps the real S/D on the
 * first rating (see `applyReview`'s New path), so the placeholder difficulty is inert.
 *
 * `dueAt` seeding (A-1-2 / design decision D1): a word merely *encountered* in a passage is
 * not "due" the instant it is read. Passing `now` seeds `dueAt = now + DAY_MS` so the word
 * re-surfaces as a re-weaving candidate the *next day* (matching the Hard=1d first ladder
 * step) instead of permanently occupying the due queue. Because stability is still undefined
 * it never enters the /review recall queue (D1's two-faced "due" definition). Omitting `now`
 * yields the legacy `dueAt: 0` placeholder for transient seeds that are immediately reshaped
 * by a scheduler (review / recall paths).
 */

import { DAY_MS } from '../../domain/srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

/** A fresh, unlearned scheduling state (stability undefined ⇒ New). */
export function newSchedulingState(userId: UserId, wordId: string, now?: number): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: undefined,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: now !== undefined ? now + DAY_MS : 0,
    lastSource: 'passage',
    mastery: 'New',
    reappearCount: 0,
    // Record when the word was introduced so the daily new-word clamp (C-5b) can count today's
    // seeds. Transient seeds (now omitted) carry no seededAt — they are reshaped by a scheduler
    // before they matter to the day's budget.
    ...(now !== undefined ? { seededAt: now } : {}),
  };
}

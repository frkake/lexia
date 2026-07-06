/**
 * L3 — recallController: wires reading-time recognition into the SRS (design.md Flow 3,
 * task 10.2). A token interaction on a TargetSpan becomes a RecallSignal which this
 * controller maps to a scheduling change:
 *   read state (seed New if absent; skip if the word is suspended「もう覚えた」, C-5d) → read the
 *   last update time of ANY source (for the cross-source daily cooldown) → RecallEventService.apply →
 *   persist the new WordSchedulingState and append the passage-origin ReviewLog entry. A
 *   cooldown-suppressed (or suspended) signal makes no change (`applied:false`), preventing
 *   double-counting with a same-day explicit review. The reactive `useScheduling` read then reflects
 *   the new Stability / mastery immediately.
 */

import { recallEventService, type RecallEventService } from '../../domain/srs/recallEventService';
import { newSchedulingState } from './newState';
import type { SchedulingRepository, ReviewLogRepository } from '../../types/ports';
import type { RecallSignal, UserId, WordSchedulingState } from '../../types/domain';

export interface RecallControllerDeps {
  scheduling: SchedulingRepository;
  reviewLog: ReviewLogRepository;
  /** Defaults to the singleton RecallEventService. */
  recall?: RecallEventService;
}

export interface RecallOutcome {
  /** false when suppressed by the daily cooldown (no scheduling change made). */
  applied: boolean;
  state: WordSchedulingState;
}

export async function applyRecallSignal(
  deps: RecallControllerDeps,
  userId: UserId,
  signal: RecallSignal,
): Promise<RecallOutcome> {
  const recall = deps.recall ?? recallEventService;
  const { wordId } = signal;

  const existing = await deps.scheduling.get(userId, wordId);
  // C-5d: a suspended (known-declared) word takes no reading-time recall — neither a re-seed nor a
  // read-through/lookup credit — so「もう覚えた」keeps it out of scheduling entirely.
  if (existing?.suspended) return { applied: false, state: existing };

  const state = existing ?? newSchedulingState(userId, wordId, signal.at);
  const lastUpdateAt = (await deps.reviewLog.lastUpdate(userId, wordId)) ?? null;

  const { next, logEntry } = recall.apply(state, signal, lastUpdateAt);
  if (!logEntry) return { applied: false, state };

  await deps.scheduling.upsert(next);
  await deps.reviewLog.append(logEntry);
  return { applied: true, state: next };
}

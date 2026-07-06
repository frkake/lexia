/**
 * L1 — RecallEventService: maps reading-time recognition to FSRS grades (design.md
 * "RecallEventService", Flow 3).
 *   - a lookup tap → Again (1) lapse;
 *   - a tap-free read-through → a damped Good, `S' = S + decay·(S_good − S)`,
 *     crediting passive recognition less than active recall;
 *   - a passage-origin update of the same word is debounced by a daily cooldown against the last
 *     scheduling change of ANY source (C-5d): a same-day explicit「知らなかった」/review is not
 *     overwritten by a subsequent read-through, so a lapse's 10-minute step survives to completion;
 *   - passage events never promote the mastery stage and are recorded append-only
 *     with `source='passage'`.
 *
 * NOTE on the contract: design.md sketches `apply(state, signal, log)` with an async
 * ReviewLogReader. To keep this an I/O-free pure domain service, the resolved last-update timestamp
 * is passed in instead; the state layer reads it from `ReviewLogRepository.lastUpdate` (latest entry
 * of any source) before calling.
 */

import { fsrs } from './fsrsScheduler';
import { masteryProjector } from './masteryProjector';
import { PASSIVE_RECALL_DECAY, DAILY_COOLDOWN_MS } from './parameters';
import type { Rating, RecallSignal, ReviewLogEntry, WordSchedulingState } from '../../types/domain';

export interface RecallApplyResult {
  next: WordSchedulingState;
  /** null when suppressed by the daily cooldown (no scheduling change made). */
  logEntry: ReviewLogEntry | null;
}

export interface RecallEventService {
  apply(
    state: WordSchedulingState,
    signal: RecallSignal,
    /** Latest scheduling change of ANY source for this word (cross-source cooldown, C-5d). */
    lastUpdateAt: number | null,
  ): RecallApplyResult;
}

function apply(
  state: WordSchedulingState,
  signal: RecallSignal,
  lastUpdateAt: number | null,
): RecallApplyResult {
  // Daily cooldown (cross-source, C-5d): a passage-origin update within the window of the word's
  // last scheduling change — review OR passage — is suppressed, so a same-day「知らなかった」isn't
  // overwritten by the read-through fired on completion.
  if (lastUpdateAt !== null && signal.at - lastUpdateAt < DAILY_COOLDOWN_MS) {
    return { next: state, logEntry: null };
  }

  const rating: Rating = signal.kind === 'lookup' ? 1 : 3;
  const projected = fsrs.simulate(state, rating, signal.at);

  let stability = projected.stability!;
  let dueAt = projected.dueAt;
  if (signal.kind === 'read_through') {
    // Damped Good: credit passive recognition as a fraction of a full Good gain.
    const before = state.stability ?? 0;
    stability = before + PASSIVE_RECALL_DECAY * (projected.stability! - before);
    dueAt = signal.at + fsrs.nextIntervalMs({ ...projected, stability });
  }

  // Passage events recompute the stage but never promote (uses the original stage as base).
  const mastery = masteryProjector.deriveMastery(
    { ...state, stability, lapses: projected.lapses },
    { kind: 'passage' },
  );

  const next: WordSchedulingState = {
    ...projected,
    stability,
    dueAt,
    lastSource: 'passage',
    reappearCount: state.reappearCount + 1,
    mastery,
  };

  const logEntry: ReviewLogEntry = {
    userId: state.userId,
    wordId: signal.wordId,
    rating,
    source: 'passage',
    at: signal.at,
    stabilityAfter: stability,
  };

  return { next, logEntry };
}

export const recallEventService: RecallEventService = { apply };

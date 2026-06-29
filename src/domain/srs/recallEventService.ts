/**
 * L1 — RecallEventService: maps reading-time recognition to FSRS grades (design.md
 * "RecallEventService", Flow 3).
 *   - a lookup tap → Again (1) lapse;
 *   - a tap-free read-through → a damped Good, `S' = S + decay·(S_good − S)`,
 *     crediting passive recognition less than active recall;
 *   - passage-origin updates of the same word are debounced by a daily cooldown to
 *     avoid double-counting with a same-day explicit review;
 *   - passage events never promote the mastery stage and are recorded append-only
 *     with `source='passage'`.
 *
 * NOTE on the contract: design.md sketches `apply(state, signal, log)` with an async
 * ReviewLogReader. To keep this an I/O-free pure domain service, the resolved
 * last-passage-update timestamp is passed in instead; the state layer reads it from
 * ReviewLogRepository.lastPassageUpdate before calling.
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
    lastPassageUpdateAt: number | null,
  ): RecallApplyResult;
}

function apply(
  state: WordSchedulingState,
  signal: RecallSignal,
  lastPassageUpdateAt: number | null,
): RecallApplyResult {
  // Daily cooldown: a second passage-origin update within the window is suppressed.
  if (lastPassageUpdateAt !== null && signal.at - lastPassageUpdateAt < DAILY_COOLDOWN_MS) {
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

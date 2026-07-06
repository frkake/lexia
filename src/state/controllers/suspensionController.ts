/**
 * L3 — suspensionController: the known-word declaration path (C-5d). When the learner marks a word
 * 「もう覚えた（復習から外す）」it is suspended; 「復習に戻す」clears the flag. A suspended word is
 * excluded from the /review queue and the home due count (`isDueForReview`), from the re-weaving
 * suggestion pool (`wordSuggestionService`), and from reading-time recall seeding/crediting
 * (recallController). This module owns only the scheduling mutation — pure I/O over the injected
 * repository — so the WordDetailCard and the wordbook share one implementation.
 */

import { newSchedulingState } from './newState';
import type { SchedulingRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';

export interface SuspensionControllerDeps {
  scheduling: SchedulingRepository;
}

/**
 * Set (`suspended=true`) or clear (`suspended=false`) the known-word flag for a word, returning the
 * resulting state. Suspending a word that has no scheduling row yet seeds one (so a merely-suggested
 * word can be declared known and stay out of future suggestions); restoring a word that has no row
 * is a no-op (nothing was ever due).
 */
export async function setWordSuspended(
  deps: SuspensionControllerDeps,
  userId: UserId,
  wordId: string,
  suspended: boolean,
  now: number,
): Promise<WordSchedulingState | undefined> {
  const existing = await deps.scheduling.get(userId, wordId);
  if (!existing) {
    if (!suspended) return undefined; // nothing to restore
    const seeded: WordSchedulingState = { ...newSchedulingState(userId, wordId, now), suspended: true };
    await deps.scheduling.upsert(seeded);
    return seeded;
  }
  if (!!existing.suspended === suspended) return existing; // already in the desired state
  const next: WordSchedulingState = { ...existing, suspended };
  await deps.scheduling.upsert(next);
  return next;
}

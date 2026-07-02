/**
 * L3 — sessionBootstrap: revisit restore + preference hydration (design.md Flow / 13.x,
 * task 10.4).
 *   - `restoreReadingSession` reopens the learner's most-recent in-progress passage:
 *     load the stored PassageOutput, re-index it deterministically with the shared
 *     tokenizer (passages are stored normalized, indexed on load), start the reading
 *     session and seek to the saved sentence position so "continue reading" resumes.
 *   - `hydrateSettings` binds the SettingsRepository to the settingsStore and loads the
 *     persisted display preferences (translation mode, font scale, voice, rate, lastSetup;
 *     theme/locale prefer the synchronous localStorage read for a FOUC-free start).
 *
 * Generation/TTS/persistence error degrade is wired in the generationController (text
 * continues, player marked unavailable); these two restore the prior state on revisit.
 */

import { tokenizer } from '../../domain/tokenizer/joinService';
import type { SessionStore } from '../stores/sessionStore';
import type { SettingsStore } from '../stores/settingsStore';
import type { PassageRepository, ProgressRepository, SettingsRepository } from '../../types/ports';
import type { IndexedPassage, UserId } from '../../types/domain';

export interface RestoreDeps {
  passages: PassageRepository;
  progress: ProgressRepository;
  session: SessionStore;
}

/** Reopen the most-recent in-progress passage at its saved position (null if none). */
export async function restoreReadingSession(deps: RestoreDeps, userId: UserId): Promise<IndexedPassage | null> {
  const inProgress = await deps.progress.byStatus(userId, 'in_progress'); // newest-started first
  const latest = inProgress[0];
  if (!latest) return null;

  const record = await deps.passages.get(latest.passageId);
  if (!record) return null;

  const passage = tokenizer.index(record.passageId, record.passage);
  deps.session.getState().startPassage(passage, latest.startedAt);
  deps.session.getState().updateProgress(latest.sentenceIndex);
  return passage;
}

/** Bind the settings repository to the store and load persisted preferences. */
export async function hydrateSettings(
  store: SettingsStore,
  repo: SettingsRepository,
  userId: UserId,
): Promise<void> {
  store.getState().configure(repo, userId);
  await store.getState().hydrate();
}

export interface OpenPassageDeps {
  passages: PassageRepository;
  progress: ProgressRepository;
  session: SessionStore;
}

/**
 * Open a specific passage by id into the reading session (URL-addressable reader). Loads the stored
 * record, re-indexes it with the shared tokenizer, starts the session, and seeks to the learner's
 * saved sentence position. Returns null (session untouched) when the passage is missing or owned by
 * another learner — the route renders a "not found" state rather than crashing.
 */
export async function openPassage(
  deps: OpenPassageDeps,
  userId: UserId,
  passageId: string,
): Promise<IndexedPassage | null> {
  const record = await deps.passages.get(passageId);
  if (!record || record.userId !== userId) return null;

  const passage = tokenizer.index(record.passageId, record.passage);
  const now = record.createdAt;
  deps.session.getState().startPassage(passage, now);

  const saved = await deps.progress.get(userId, passageId);
  if (saved) deps.session.getState().updateProgress(saved.sentenceIndex);
  return passage;
}

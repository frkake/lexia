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
import type { IndexedPassage, ReadingProgress, UserId } from '../../types/domain';

export interface RestoreDeps {
  passages: PassageRepository;
  progress: ProgressRepository;
  session: SessionStore;
}

/**
 * Reopen the most-recently-opened in-progress passage at its saved position (null if none). Stamps
 * `lastOpenedAt = now` so the revisit counts as an open and the passage stays at the head of the
 * "続きを読む" ordering. `startedAt` is preserved from the saved row.
 */
export async function restoreReadingSession(
  deps: RestoreDeps,
  userId: UserId,
  now: number,
): Promise<IndexedPassage | null> {
  const inProgress = await deps.progress.byStatus(userId, 'in_progress');
  let latest: ReadingProgress | undefined;
  for (const p of inProgress) {
    if (!latest || p.lastOpenedAt > latest.lastOpenedAt) latest = p;
  }
  if (!latest) return null;

  const record = await deps.passages.get(latest.passageId);
  if (!record) return null;

  const passage = tokenizer.index(record.passageId, record.passage);
  deps.session.getState().startPassage(passage, latest.startedAt, now);
  deps.session.getState().updateProgress(latest.sentenceIndex);
  const progress = deps.session.getState().toReadingProgress(userId);
  if (progress) await deps.progress.upsert(progress);
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
 *
 * Stamps `lastOpenedAt = now` on the progress row (F-2) so opening a passage — from the library, a
 * shared URL, or the CONTINUE card — moves it to the head of the "続きを読む" ordering. `startedAt` and
 * a prior `completed` status are preserved so reopening a finished passage doesn't reset it.
 */
export async function openPassage(
  deps: OpenPassageDeps,
  userId: UserId,
  passageId: string,
  now: number,
): Promise<IndexedPassage | null> {
  const record = await deps.passages.get(passageId);
  if (!record || record.userId !== userId) return null;

  const passage = tokenizer.index(record.passageId, record.passage);
  const saved = await deps.progress.get(userId, passageId);
  // Preserve the original start; only lastOpenedAt (openedAt) advances to now.
  deps.session.getState().startPassage(passage, saved?.startedAt ?? record.createdAt, now);
  if (saved) {
    deps.session.getState().updateProgress(saved.sentenceIndex);
    if (saved.status === 'completed') deps.session.getState().markCompleted(saved.completedAt ?? now);
  }

  const progress = deps.session.getState().toReadingProgress(userId);
  if (progress) await deps.progress.upsert(progress);
  return passage;
}

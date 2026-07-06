/**
 * L3 — useReadingProgressPersistence (F-2, wiring layer). Persists the live reading position from
 * the session store to the ProgressRepository so the learner can close the tab and resume later.
 *
 * The session store is the source of truth; `useSentenceTracking` advances its `sentenceIndex` as
 * the learner scrolls. This hook subscribes to those changes and writes them through:
 *   - a debounced upsert (default 3s) so scrolling doesn't hammer IndexedDB;
 *   - an immediate flush on `visibilitychange → hidden` and `pagehide` (tab close / backgrounding),
 *     and on unmount, so the last position is never lost.
 *
 * It writes whatever `session.toReadingProgress(userId)` yields (null when no passage is active is a
 * no-op), so a passage marked completed persists as completed. Pure wiring: no React state, no DOM.
 */

import { useEffect } from 'react';
import type { SessionStore } from '../stores/sessionStore';
import type { ProgressRepository } from '../../types/ports';
import type { UserId } from '../../types/domain';

export interface ReadingProgressPersistenceOptions {
  /** Debounce window for scroll-driven writes, in ms (default 3000). */
  debounceMs?: number;
}

export function useReadingProgressPersistence(
  session: SessionStore,
  progress: ProgressRepository,
  userId: UserId,
  { debounceMs = 3000 }: ReadingProgressPersistenceOptions = {},
): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;

    const flush = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!pending) return;
      pending = false;
      const snapshot = session.getState().toReadingProgress(userId);
      if (snapshot) void progress.upsert(snapshot);
    };

    const schedule = (): void => {
      pending = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    };

    const unsubscribe = session.subscribe((state, prev) => {
      if (state.sentenceIndex !== prev.sentenceIndex || state.status !== prev.status) schedule();
    });

    const onPageHide = (): void => flush();
    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    };
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [session, progress, userId, debounceMs]);
}

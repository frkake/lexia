/**
 * L3 — sessionStore: holds the in-progress passage and reading UI state (current
 * sentence, percent, the open word) so reading can be resumed after interruption
 * (design.md "useScheduling …和 sessionStore", 13.2). It owns no I/O; the wiring layer
 * reads `toReadingProgress()` to persist via ProgressRepository and rehydrates on
 * revisit. Timestamps are passed in so the store stays deterministic under test.
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { IndexedPassage, ReadingProgress, UserId } from '../../types/domain';

export type SessionStatus = 'idle' | 'in_progress' | 'completed';

export interface SessionState {
  passage: IndexedPassage | null;
  status: SessionStatus;
  sentenceIndex: number;
  percent: number;
  activeWordId: string | null;
  startedAt: number;
  completedAt?: number;

  startPassage(passage: IndexedPassage, now: number): void;
  replacePassage(passage: IndexedPassage): void;
  updateProgress(sentenceIndex: number): void;
  setActiveWord(wordId: string | null): void;
  markCompleted(now: number): void;
  /** Build a persistable ReadingProgress for the active passage (null if none). */
  toReadingProgress(userId: UserId): ReadingProgress | null;
  reset(): void;
}

const pct = (sentenceIndex: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round(((sentenceIndex + 1) / total) * 100)) : 0;

export type SessionStore = ReturnType<typeof createSessionStore>;

export function createSessionStore() {
  return createStore<SessionState>()((set, get) => ({
    passage: null,
    status: 'idle',
    sentenceIndex: 0,
    percent: 0,
    activeWordId: null,
    startedAt: 0,
    completedAt: undefined,

    startPassage(passage, now) {
      set({
        passage,
        status: 'in_progress',
        sentenceIndex: 0,
        percent: 0,
        activeWordId: null,
        startedAt: now,
        completedAt: undefined,
      });
    },

    replacePassage(passage) {
      const current = get().passage;
      if (!current || current.passageId !== passage.passageId) return;
      set({ passage });
    },

    updateProgress(sentenceIndex) {
      const { passage } = get();
      const total = passage?.sentences.length ?? 0;
      set({ sentenceIndex, percent: pct(sentenceIndex, total) });
    },

    setActiveWord(wordId) {
      set({ activeWordId: wordId });
    },

    markCompleted(now) {
      set({ status: 'completed', percent: 100, completedAt: now });
    },

    toReadingProgress(userId) {
      const s = get();
      if (!s.passage) return null;
      return {
        userId,
        passageId: s.passage.passageId,
        sentenceIndex: s.sentenceIndex,
        percent: s.percent,
        status: s.status === 'completed' ? 'completed' : 'in_progress',
        startedAt: s.startedAt,
        ...(s.completedAt !== undefined ? { completedAt: s.completedAt } : {}),
      };
    },

    reset() {
      set({
        passage: null,
        status: 'idle',
        sentenceIndex: 0,
        percent: 0,
        activeWordId: null,
        startedAt: 0,
        completedAt: undefined,
      });
    },
  }));
}

/** App-wide singleton reading session. */
export const sessionStore = createSessionStore();

export function useSessionStore<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

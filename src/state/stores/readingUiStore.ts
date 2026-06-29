/**
 * L3 — ReadingUiStore: ephemeral UI state that links a "気づき" annotation (NoticeRail
 * item) to its exact prose span (PassageRenderer badge + tokens) — the "Spotlight Link".
 * Pointing at either side sets `hoverCueIndex` (a transient preview); clicking pins it via
 * `pinnedCueIndex` so the pairing survives the smooth-scroll, keyboard focus moves and
 * touch (no hover). The *effective* lit cue is `hover ?? pinned` so a hover previews a
 * different cue and snaps back to the pin on leave. State lives in a store (not component
 * state) because ReadingScreen's right rail can be injected via the `rail` prop, yet the
 * injected rail must still drive the same single highlight. Reset on passage change.
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface ReadingUiState {
  /** Cue under the pointer/keyboard focus right now (transient preview). */
  hoverCueIndex: number | null;
  /** Cue pinned by a click — survives scroll, blur and touch until re-pinned/cleared. */
  pinnedCueIndex: number | null;

  setHover(index: number | null): void;
  setPinned(index: number | null): void;
  clearPin(): void;
  reset(): void;
}

/** The cue that should actually be lit: a live hover preview wins, else the pin. */
export function effectiveCueIndex(state: ReadingUiState): number | null {
  return state.hoverCueIndex ?? state.pinnedCueIndex;
}

export type ReadingUiStore = ReturnType<typeof createReadingUiStore>;

export function createReadingUiStore() {
  return createStore<ReadingUiState>()((set) => ({
    hoverCueIndex: null,
    pinnedCueIndex: null,

    setHover(index) {
      set({ hoverCueIndex: index });
    },

    setPinned(index) {
      set({ pinnedCueIndex: index });
    },

    clearPin() {
      set({ pinnedCueIndex: null });
    },

    reset() {
      set({ hoverCueIndex: null, pinnedCueIndex: null });
    },
  }));
}

/** App-wide singleton: one lit cue shared by the prose and the (possibly injected) rail. */
export const readingUiStore = createReadingUiStore();

export function useReadingUiStore<T>(selector: (state: ReadingUiState) => T): T {
  return useStore(readingUiStore, selector);
}

/** Subscribe to the effective (hover ?? pinned) lit cue. */
export function useEffectiveCue(): number | null {
  return useReadingUiStore(effectiveCueIndex);
}

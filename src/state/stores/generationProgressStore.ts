/**
 * L3 — generationProgressStore: the single app-wide surface for an in-flight passage generation
 * (D-7). Generation is a multi-second serial LLM pipeline (resolve words → generate body →
 * repair → annotate); this store exposes the current phase, when it started, an AbortController
 * to cancel it, and — once settled — the result path (for the completion toast / navigate) or an
 * error message. It is a singleton (like playerStore / readingUiStore / toastStore) precisely so
 * the progress survives navigating away from Home: the pipeline runs in a route closure while this
 * store, mounted in AppShell, keeps the TopNav indicator + completion notice alive on any screen.
 *
 * The store stays pure state + actions. Elapsed-time ticking and the navigate-vs-toast decision
 * live in the view (GenerationProgressPanel / AppShell) so unit tests are timer-free. `runId` is a
 * monotonic per-run token the completion bridge uses to fire exactly once per generation (and to
 * ignore a terminal state it did not itself start — e.g. one left over between tests).
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type GenerationPhase =
  | 'idle'
  /** Resolving target words + fetching their word data (pre-generation setup). */
  | 'words'
  /** The body-generation LLM call (generate → validate). */
  | 'passage'
  /** A guided repair re-request after a failed validation. */
  | 'repair'
  /** The exhaustive annotation pass on the accepted body. */
  | 'annotate'
  /** Settled: the passage is persisted and ready to open (`resultPath`). */
  | 'done'
  /** Settled: the pipeline failed / timed out (`error`). Cancellation returns to `idle`, not here. */
  | 'error';

/** Phases during which a generation is actively in flight (form disabled, cancel offered). */
export type GenerationActivePhase = 'words' | 'passage' | 'repair' | 'annotate';

const ACTIVE_PHASES: ReadonlySet<GenerationPhase> = new Set<GenerationPhase>([
  'words',
  'passage',
  'repair',
  'annotate',
]);

/** True while a generation is actively running (used to disable the form + show the progress panel). */
export function isGenerationActive(phase: GenerationPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export interface GenerationProgressState {
  phase: GenerationPhase;
  /** Epoch ms when the current run started (for the elapsed counter). Null when idle. */
  startedAt: number | null;
  /** Human-readable failure message (phase === 'error'). */
  error: string | null;
  /** The finished passage id (phase === 'done'). */
  resultPassageId: string | null;
  /** Reader URL for the finished passage (phase === 'done') — /p/:id or /s/:storyId/:chapterIndex. */
  resultPath: string | null;
  /** Aborts the in-flight fetch chain; null once settled/cancelled. */
  abortController: AbortController | null;
  /** Monotonic run token (bumped on start) so a completion is handled exactly once. */
  runId: number;

  /** Begin a run: mint a fresh AbortController, enter the first phase, return the controller. */
  start(now: number): AbortController;
  /** Advance to the next active phase (ignored once settled/cancelled). */
  setPhase(phase: GenerationActivePhase): void;
  /** Settle successfully with the reader path (ignored if the run was already cancelled). */
  finish(passageId: string, path: string): void;
  /** Settle with an error message (ignored if the run was already cancelled). */
  fail(message: string): void;
  /** User cancel: abort the in-flight fetch chain and return to idle. */
  cancel(): void;
  /** Return to idle without aborting (used by the completion bridge after handling a result). */
  reset(): void;
}

export type GenerationProgressStore = ReturnType<typeof createGenerationProgressStore>;

const IDLE = {
  phase: 'idle' as GenerationPhase,
  startedAt: null,
  error: null,
  resultPassageId: null,
  resultPath: null,
  abortController: null,
} as const;

export function createGenerationProgressStore() {
  return createStore<GenerationProgressState>()((set, get) => ({
    ...IDLE,
    runId: 0,

    start(now) {
      const controller = new AbortController();
      set((s) => ({
        ...IDLE,
        phase: 'words',
        startedAt: now,
        abortController: controller,
        runId: s.runId + 1,
      }));
      return controller;
    },

    setPhase(phase) {
      // Only an active run (still holding its controller) may advance — a late phase event from a
      // cancelled/settled run must not revive the panel.
      set((s) => (s.abortController ? { phase } : s));
    },

    finish(passageId, path) {
      set((s) =>
        s.abortController
          ? { phase: 'done', resultPassageId: passageId, resultPath: path, error: null, abortController: null }
          : s,
      );
    },

    fail(message) {
      set((s) => (s.abortController ? { phase: 'error', error: message, abortController: null } : s));
    },

    cancel() {
      get().abortController?.abort();
      set({ ...IDLE });
    },

    reset() {
      set({ ...IDLE });
    },
  }));
}

/** App-wide singleton: one in-flight generation shared by Home, the TopNav indicator and toasts. */
export const generationProgressStore = createGenerationProgressStore();

export function useGenerationProgressStore<T>(selector: (state: GenerationProgressState) => T): T {
  return useStore(generationProgressStore, selector);
}

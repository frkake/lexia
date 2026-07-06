/**
 * L3 — toastStore: the single app-wide surface for transient notifications
 * (success / error / info) with an optional single action such as "取り消す" (Undo).
 *
 * This is the shared foundation mandated by design judgement D6: rating-Undo (C-5c /
 * reviewController), read-through feedback (C-5d), the generation-complete notice (D-7) and
 * the config / annotation banners (F-1 / F-6) all push here instead of rolling their own
 * toast. The store stays pure state + actions — auto-dismiss timing lives in the view
 * (`ToastViewport`) so unit tests are timer-free and the same toast can outlive re-renders.
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

/** A single actionable button on a toast (e.g. Undo). Running it dismisses the toast. */
export interface ToastAction {
  label: string;
  onAction(): void;
}

export interface ToastInput {
  message: string;
  /** Visual + a11y severity. Default `'info'`. */
  tone?: ToastTone;
  /** Optional single action button. */
  action?: ToastAction;
  /** ms before auto-dismiss; `0` keeps it until explicitly dismissed. Default 5000. */
  durationMs?: number;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

export const DEFAULT_TOAST_DURATION_MS = 5000;

export interface ToastState {
  toasts: Toast[];
  /** Push a toast and return its id (for imperative dismissal). */
  show(input: ToastInput): number;
  dismiss(id: number): void;
  clear(): void;
}

export type ToastStore = ReturnType<typeof createToastStore>;

export function createToastStore() {
  let nextId = 1;
  return createStore<ToastState>()((set) => ({
    toasts: [],

    show(input) {
      const id = nextId++;
      const toast: Toast = {
        id,
        message: input.message,
        tone: input.tone ?? 'info',
        action: input.action,
        durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
      };
      set((s) => ({ toasts: [...s.toasts, toast] }));
      return id;
    },

    dismiss(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    clear() {
      set({ toasts: [] });
    },
  }));
}

/** App-wide singleton: one toast surface shared by every feature. */
export const toastStore = createToastStore();

export function useToastStore<T>(selector: (state: ToastState) => T): T {
  return useStore(toastStore, selector);
}

/** Convenience: push a toast onto the app-wide store. Returns its id. */
export function showToast(input: ToastInput): number {
  return toastStore.getState().show(input);
}

export function dismissToast(id: number): void {
  toastStore.getState().dismiss(id);
}

import { describe, it, expect } from 'vitest';
import { createToastStore, toastStore, showToast, dismissToast, DEFAULT_TOAST_DURATION_MS } from './toastStore';

describe('toastStore', () => {
  it('adds a toast with defaults and returns its id', () => {
    const store = createToastStore();
    const id = store.getState().show({ message: 'hello' });
    const t = store.getState().toasts[0]!;
    expect(store.getState().toasts).toHaveLength(1);
    expect(t.id).toBe(id);
    expect(t.message).toBe('hello');
    expect(t.tone).toBe('info');
    expect(t.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(t.action).toBeUndefined();
  });

  it('honors explicit tone / action / duration', () => {
    const store = createToastStore();
    const onAction = () => {};
    store.getState().show({ message: 'saved', tone: 'success', durationMs: 0, action: { label: '取り消す', onAction } });
    const t = store.getState().toasts[0]!;
    expect(t.tone).toBe('success');
    expect(t.durationMs).toBe(0);
    expect(t.action?.label).toBe('取り消す');
    expect(t.action?.onAction).toBe(onAction);
  });

  it('assigns unique, monotonically increasing ids', () => {
    const store = createToastStore();
    const a = store.getState().show({ message: 'a' });
    const b = store.getState().show({ message: 'b' });
    expect(b).toBeGreaterThan(a);
    expect(store.getState().toasts.map((t) => t.id)).toEqual([a, b]);
  });

  it('dismiss removes only the matching toast', () => {
    const store = createToastStore();
    const a = store.getState().show({ message: 'a' });
    const b = store.getState().show({ message: 'b' });
    store.getState().dismiss(a);
    expect(store.getState().toasts.map((t) => t.id)).toEqual([b]);
  });

  it('clear removes all toasts', () => {
    const store = createToastStore();
    store.getState().show({ message: 'a' });
    store.getState().show({ message: 'b' });
    store.getState().clear();
    expect(store.getState().toasts).toEqual([]);
  });

  it('singleton helpers push onto and dismiss from the shared store', () => {
    toastStore.getState().clear();
    const id = showToast({ message: 'via helper' });
    expect(toastStore.getState().toasts).toHaveLength(1);
    dismissToast(id);
    expect(toastStore.getState().toasts).toHaveLength(0);
  });
});

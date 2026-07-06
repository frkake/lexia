import { describe, it, expect } from 'vitest';
import { createGenerationProgressStore, isGenerationActive } from './generationProgressStore';

describe('generationProgressStore', () => {
  it('starts a run in the words phase with a fresh AbortController and a bumped runId', () => {
    const store = createGenerationProgressStore();
    const before = store.getState().runId;
    const controller = store.getState().start(1000);
    const s = store.getState();
    expect(s.phase).toBe('words');
    expect(s.startedAt).toBe(1000);
    expect(s.error).toBeNull();
    expect(s.resultPassageId).toBeNull();
    expect(s.abortController).toBe(controller);
    expect(controller.signal.aborted).toBe(false);
    expect(s.runId).toBe(before + 1);
  });

  it('advances through active phases while a run is in flight', () => {
    const store = createGenerationProgressStore();
    store.getState().start(0);
    store.getState().setPhase('passage');
    expect(store.getState().phase).toBe('passage');
    store.getState().setPhase('repair');
    expect(store.getState().phase).toBe('repair');
    store.getState().setPhase('annotate');
    expect(store.getState().phase).toBe('annotate');
  });

  it('finishes with the reader path and clears the controller', () => {
    const store = createGenerationProgressStore();
    store.getState().start(0);
    store.getState().finish('p_1', '/p/p_1');
    const s = store.getState();
    expect(s.phase).toBe('done');
    expect(s.resultPassageId).toBe('p_1');
    expect(s.resultPath).toBe('/p/p_1');
    expect(s.abortController).toBeNull();
  });

  it('fails with a message and clears the controller', () => {
    const store = createGenerationProgressStore();
    store.getState().start(0);
    store.getState().fail('タイムアウトしました');
    const s = store.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toBe('タイムアウトしました');
    expect(s.abortController).toBeNull();
  });

  it('cancel aborts the controller and returns to idle', () => {
    const store = createGenerationProgressStore();
    const controller = store.getState().start(0);
    store.getState().setPhase('passage');
    store.getState().cancel();
    expect(controller.signal.aborted).toBe(true);
    const s = store.getState();
    expect(s.phase).toBe('idle');
    expect(s.startedAt).toBeNull();
    expect(s.abortController).toBeNull();
  });

  it('ignores a late phase / finish / fail after cancellation (no panel revival)', () => {
    const store = createGenerationProgressStore();
    store.getState().start(0);
    store.getState().cancel();
    // The still-running pipeline may emit these after the user already cancelled.
    store.getState().setPhase('annotate');
    store.getState().finish('p_2', '/p/p_2');
    store.getState().fail('遅れて来たエラー');
    expect(store.getState().phase).toBe('idle');
  });

  it('reset returns to idle without aborting and preserves runId monotonicity', () => {
    const store = createGenerationProgressStore();
    store.getState().start(0);
    const runAfterStart = store.getState().runId;
    store.getState().finish('p_3', '/p/p_3');
    store.getState().reset();
    expect(store.getState().phase).toBe('idle');
    // reset must not rewind runId (the completion bridge relies on it never going backwards).
    expect(store.getState().runId).toBe(runAfterStart);
    store.getState().start(0);
    expect(store.getState().runId).toBe(runAfterStart + 1);
  });

  it('isGenerationActive is true only for in-flight phases', () => {
    expect(isGenerationActive('idle')).toBe(false);
    expect(isGenerationActive('words')).toBe(true);
    expect(isGenerationActive('passage')).toBe(true);
    expect(isGenerationActive('repair')).toBe(true);
    expect(isGenerationActive('annotate')).toBe(true);
    expect(isGenerationActive('done')).toBe(false);
    expect(isGenerationActive('error')).toBe(false);
  });
});

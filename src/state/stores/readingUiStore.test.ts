import { describe, it, expect } from 'vitest';
import { createReadingUiStore, effectiveCueIndex } from './readingUiStore';

describe('ReadingUiStore', () => {
  it('starts with nothing hovered or pinned', () => {
    const store = createReadingUiStore();
    expect(store.getState().hoverCueIndex).toBeNull();
    expect(store.getState().pinnedCueIndex).toBeNull();
  });

  it('sets and clears the hovered cue', () => {
    const store = createReadingUiStore();
    store.getState().setHover(2);
    expect(store.getState().hoverCueIndex).toBe(2);
    store.getState().setHover(null);
    expect(store.getState().hoverCueIndex).toBeNull();
  });

  it('pins a cue and clears the pin without touching the hover', () => {
    const store = createReadingUiStore();
    store.getState().setHover(1);
    store.getState().setPinned(3);
    expect(store.getState().pinnedCueIndex).toBe(3);

    store.getState().clearPin();
    expect(store.getState().pinnedCueIndex).toBeNull();
    expect(store.getState().hoverCueIndex).toBe(1);
  });

  it('prefers a hovered cue over the pinned one, falling back to the pin on leave', () => {
    const store = createReadingUiStore();
    store.getState().setPinned(3);
    expect(effectiveCueIndex(store.getState())).toBe(3);

    store.getState().setHover(5); // hovering a different cue previews it
    expect(effectiveCueIndex(store.getState())).toBe(5);

    store.getState().setHover(null); // leaving snaps back to the pinned cue
    expect(effectiveCueIndex(store.getState())).toBe(3);
  });

  it('reports no effective cue when neither is set', () => {
    const store = createReadingUiStore();
    expect(effectiveCueIndex(store.getState())).toBeNull();
  });

  it('resets both hover and pin (used on passage change)', () => {
    const store = createReadingUiStore();
    store.getState().setHover(1);
    store.getState().setPinned(2);

    store.getState().reset();
    expect(store.getState().hoverCueIndex).toBeNull();
    expect(store.getState().pinnedCueIndex).toBeNull();
  });
});

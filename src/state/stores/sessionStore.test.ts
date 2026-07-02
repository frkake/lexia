import { describe, it, expect } from 'vitest';
import { createSessionStore } from './sessionStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { IndexedPassage, PassageOutput, UserId } from '../../types/domain';

const U = 'u1' as UserId;

function indexedPassage(): IndexedPassage {
  const passage: PassageOutput = {
    meta: { title: 'Story', intent: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 10 },
    sentences: Array.from({ length: 5 }, (_, i) => ({ tokens: ['Sentence', String(i), '.'], translationJa: '' })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('p1', passage);
}

describe('sessionStore', () => {
  it('starts a passage in progress at zero', () => {
    const store = createSessionStore();
    store.getState().startPassage(indexedPassage(), 1_000);
    const s = store.getState();
    expect(s.status).toBe('in_progress');
    expect(s.percent).toBe(0);
    expect(s.sentenceIndex).toBe(0);
    expect(s.startedAt).toBe(1_000);
  });

  it('updates reading progress and preserves it for persistence on interruption', () => {
    const store = createSessionStore();
    store.getState().startPassage(indexedPassage(), 1_000);
    store.getState().updateProgress(2); // 3rd of 5 sentences
    expect(store.getState().sentenceIndex).toBe(2);
    expect(store.getState().percent).toBe(60);

    const progress = store.getState().toReadingProgress(U);
    expect(progress).toMatchObject({
      userId: U,
      passageId: 'p1',
      sentenceIndex: 2,
      percent: 60,
      status: 'in_progress',
      startedAt: 1_000,
    });
  });

  it('tracks the active word for the detail card', () => {
    const store = createSessionStore();
    store.getState().startPassage(indexedPassage(), 0);
    store.getState().setActiveWord('w1');
    expect(store.getState().activeWordId).toBe('w1');
    store.getState().setActiveWord(null);
    expect(store.getState().activeWordId).toBeNull();
  });

  it('marks completion at 100 percent', () => {
    const store = createSessionStore();
    store.getState().startPassage(indexedPassage(), 1_000);
    store.getState().markCompleted(2_000);
    const progress = store.getState().toReadingProgress(U);
    expect(progress).toMatchObject({ status: 'completed', percent: 100, completedAt: 2_000 });
  });

  it('returns null progress when no passage is active', () => {
    const store = createSessionStore();
    expect(store.getState().toReadingProgress(U)).toBeNull();
  });
});

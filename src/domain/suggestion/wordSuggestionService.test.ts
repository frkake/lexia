import { describe, it, expect } from 'vitest';
import { createWordSuggestionService } from './wordSuggestionService';
import type { ContentGateway, SchedulingRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';

const U = 'u1' as UserId;

function sched(wordId: string): WordSchedulingState {
  return {
    userId: U,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
  };
}

/** SchedulingRepository stub: only `get` matters (returns a state ⇒ word already introduced). */
function schedRepo(introduced: string[]): SchedulingRepository {
  const set = new Set(introduced);
  return {
    get: async (_u, w) => (set.has(w) ? sched(w) : undefined),
    upsert: async () => {},
    dueBefore: async () => [],
    lowStability: async () => [],
  };
}

/** ContentGateway stub whose suggestWords returns a fixed list (or throws). */
function gateway(words: string[] | (() => never)): ContentGateway {
  return {
    generatePassage: async () => {
      throw new Error('unused');
    },
    getWordData: async () => {
      throw new Error('unused');
    },
    suggestWords: typeof words === 'function' ? async () => words() : async () => words,
  };
}

describe('WordSuggestionService.suggest', () => {
  it('returns ABC-ordered, deduped candidates excluding introduced and excluded words (5.2/5.3)', async () => {
    const svc = createWordSuggestionService(gateway(['zephyr', 'apple', 'apple', 'mango', 'introduced', 'excluded']));
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      excludedWordIds: ['excluded'],
      count: 10,
    }, schedRepo(['introduced']));
    const ids = result.candidates.map((c) => c.wordId);
    expect(ids).toEqual(['apple', 'mango', 'zephyr']); // ABC, deduped, introduced+excluded removed
  });

  it('reports a shortfall (exhausted) when fewer candidates than requested survive filtering (5.5)', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'introduced']));
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      excludedWordIds: [],
      count: 5,
    }, schedRepo(['introduced']));
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple']);
    expect(result.shortfall).toEqual({ requested: 5, available: 1, reason: 'exhausted' });
  });

  it('reports a gateway_unavailable shortfall and empty candidates when suggestWords throws (5.5)', async () => {
    const svc = createWordSuggestionService(
      gateway(() => {
        throw new Error('503');
      }),
    );
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      excludedWordIds: [],
      count: 5,
    }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('reports a gateway_unavailable shortfall when the gateway cannot suggest at all', async () => {
    const gw: ContentGateway = {
      generatePassage: async () => {
        throw new Error('unused');
      },
      getWordData: async () => {
        throw new Error('unused');
      },
    };
    const svc = createWordSuggestionService(gw);
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', excludedWordIds: [], count: 5 }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('has no shortfall when the requested count is met', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', excludedWordIds: [], count: 3 }, schedRepo([]));
    expect(result.candidates).toHaveLength(3);
    expect(result.shortfall).toBeUndefined();
  });
});

describe('WordSuggestionService.normalizeSelection', () => {
  it('re-applies (case-insensitive) ABC order and dedupe to an edited selection set (5.4)', () => {
    const svc = createWordSuggestionService(gateway([]));
    expect(svc.normalizeSelection(['Zebra', 'apple', 'apple', 'Mango'])).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('is case-insensitive for dedupe but preserves the first-seen spelling', () => {
    const svc = createWordSuggestionService(gateway([]));
    expect(svc.normalizeSelection(['Apple', 'apple', 'APPLE'])).toEqual(['Apple']);
  });
});

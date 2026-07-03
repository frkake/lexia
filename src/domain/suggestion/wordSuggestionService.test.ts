import { describe, it, expect } from 'vitest';
import { createWordSuggestionService } from './wordSuggestionService';
import type { ContentGateway, SchedulingRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';

const U = 'u1' as UserId;

function sched(wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
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
    ...over,
  };
}

/** SchedulingRepository stub: only `get` matters (returns a state ⇒ word already introduced). */
function schedRepo(
  introduced: string[],
  options: { due?: WordSchedulingState[]; weak?: WordSchedulingState[] } = {},
): SchedulingRepository {
  const rows = new Map<string, WordSchedulingState>();
  for (const wordId of introduced) rows.set(wordId, sched(wordId));
  for (const state of [...(options.due ?? []), ...(options.weak ?? [])]) rows.set(state.wordId, state);
  return {
    get: async (_u, w) => rows.get(w),
    upsert: async () => {},
    dueBefore: async () => options.due ?? [],
    lowStability: async () => options.weak ?? [],
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
      now: 1_000,
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
      now: 1_000,
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
      now: 1_000,
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
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 5 }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('has no shortfall when the requested count is met', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 3 }, schedRepo([]));
    expect(result.candidates).toHaveLength(3);
    expect(result.shortfall).toBeUndefined();
  });

  it('prioritizes due and weak scheduled words before filling with new proposals', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 4,
      },
      schedRepo([], {
        due: [sched('due-word', { level: 'B1', dueAt: 500, stability: 3 })],
        weak: [sched('weak-word', { level: 'B1', dueAt: 9_999, stability: 1 })],
      }),
    );
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple', 'due-word', 'mango', 'weak-word']);
    expect(result.candidates.find((c) => c.wordId === 'due-word')?.reason).toBe('due');
    expect(result.candidates.find((c) => c.wordId === 'weak-word')?.reason).toBe('weak');
  });

  it('filters scheduled words to the target vocabulary band before filling with new proposals', async () => {
    const svc = createWordSuggestionService(gateway(['fresh-b2']));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B2',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 4,
      },
      schedRepo([], {
        due: [
          sched('at-level', { level: 'B2', dueAt: 500, stability: 3 }),
          sched('too-hard', { level: 'C1', dueAt: 500, stability: 3 }),
        ],
        weak: [
          sched('one-below', { level: 'B1', dueAt: 9_999, stability: 1 }),
          sched('too-easy', { level: 'A2', dueAt: 9_999, stability: 1 }),
        ],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['at-level', 'fresh-b2', 'one-below']);
    expect(result.candidates.map((c) => c.wordId)).not.toContain('too-hard');
    expect(result.candidates.map((c) => c.wordId)).not.toContain('too-easy');
  });

  it('uses the injected CEFR lookup for legacy scheduled rows without a stored level', async () => {
    const svc = createWordSuggestionService(gateway([]), {
      cefrOf: (wordId) => (wordId === 'legacy-due' ? 'B1' : 'C1'),
    });
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 2,
      },
      schedRepo([], {
        due: [sched('legacy-due', { dueAt: 500, stability: 3 }), sched('legacy-hard', { dueAt: 500, stability: 3 })],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['legacy-due']);
    expect(result.candidates[0]?.level).toBe('B1');
  });

  it('skips unresolved legacy scheduled rows so off-level words do not replace level-aware new proposals', async () => {
    const svc = createWordSuggestionService(gateway(['fresh']));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 1,
      },
      schedRepo([], {
        due: [sched('legacy-unknown', { dueAt: 500, stability: 3 })],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['fresh']);
    expect(result.candidates[0]?.level).toBe('B1');
  });

  it('uses desiredNewCount to cap the presented candidates', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest(
      { userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 12, desiredNewCount: 2 },
      schedRepo([]),
    );
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple', 'mango']);
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

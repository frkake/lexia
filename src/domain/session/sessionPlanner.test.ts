import { describe, it, expect } from 'vitest';
import { sessionPlanner } from './sessionPlanner';
import { SESSION_REVIEW_LIMIT } from '../srs/parameters';
import type { SchedulingRepository } from '../../types/ports';
import type { UserId, WordSchedulingState, SetupConfig, WordData } from '../../types/domain';

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

/** In-memory SchedulingRepository honoring the port's ordering contracts. */
function mockRepo(states: WordSchedulingState[]): SchedulingRepository {
  return {
    get: async (u, w) => states.find((s) => s.userId === u && s.wordId === w),
    upsert: async () => {},
    dueBefore: async (u, at) =>
      states
        .filter((s) => s.userId === u && s.dueAt <= at)
        .sort((a, b) => a.dueAt - b.dueAt),
    lowStability: async (u, limit) =>
      states
        .filter((s) => s.userId === u && s.stability !== undefined)
        .sort((a, b) => a.stability! - b.stability!)
        .slice(0, limit),
  };
}

const setup: SetupConfig = {
  examTarget: { kind: 'eiken', value: '準1' }, // → CEFR B2
  intent: 'business',
  newWordRatio: 0.3,
  wordTarget: 400,
  contentType: 'article',
  targetWordIds: ['w1', 'w2', 'w3'],
  excludedWordIds: ['w2'],
};

describe('SessionPlanner.selectCandidates', () => {
  it('prioritizes due words then weakest-stability words, deduped', async () => {
    const states = [
      sched('due-soon', { dueAt: 100, stability: 20 }),
      sched('due-later', { dueAt: 500, stability: 18 }),
      sched('weak', { dueAt: 9_000, stability: 1 }),
      sched('strong', { dueAt: 9_000, stability: 40 }),
    ];
    const candidates = await sessionPlanner.selectCandidates(mockRepo(states), U, 1_000, 10);
    const ids = candidates.map((s) => s.wordId);
    // due-soon, due-later first (due before now=1000, soonest first), then weakest.
    expect(ids.slice(0, 2)).toEqual(['due-soon', 'due-later']);
    expect(ids).toContain('weak');
    expect(ids.indexOf('weak')).toBeLessThan(ids.indexOf('strong'));
    // no duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects the candidate limit', async () => {
    const states = Array.from({ length: 20 }, (_, i) =>
      sched(`w${i}`, { dueAt: 9_999, stability: i + 1 }),
    );
    const candidates = await sessionPlanner.selectCandidates(mockRepo(states), U, 0, 5);
    expect(candidates).toHaveLength(5);
  });
});

describe('SessionPlanner.planReviewQueue', () => {
  it('returns due words due-soonest first', async () => {
    const states = [
      sched('a', { dueAt: 300 }),
      sched('b', { dueAt: 100 }),
      sched('c', { dueAt: 9_000 }), // not due
    ];
    const queue = await sessionPlanner.planReviewQueue(mockRepo(states), U, 1_000);
    expect(queue.map((s) => s.wordId)).toEqual(['b', 'a']);
  });

  it('caps the queue at SESSION_REVIEW_LIMIT, due-soonest first (C-5b)', async () => {
    const states = Array.from({ length: SESSION_REVIEW_LIMIT + 5 }, (_, i) =>
      sched(`w${i}`, { dueAt: i, stability: 5 }),
    );
    const queue = await sessionPlanner.planReviewQueue(mockRepo(states), U, 10_000);
    expect(queue).toHaveLength(SESSION_REVIEW_LIMIT);
    expect(queue.map((s) => s.wordId)).toEqual(states.slice(0, SESSION_REVIEW_LIMIT).map((s) => s.wordId));
  });

  it('excludes seeded New words (stability undefined) even when dueAt has elapsed (C-5b / isDueForReview)', async () => {
    const seeded = sched('seed', { dueAt: 100 });
    delete seeded.stability;
    const learned = sched('learned', { dueAt: 200, stability: 4 });
    const queue = await sessionPlanner.planReviewQueue(mockRepo([seeded, learned]), U, 1_000);
    expect(queue.map((s) => s.wordId)).toEqual(['learned']);
  });
});

describe('SessionPlanner.buildRequest', () => {
  it('reflects setup conditions and drops excluded target words', () => {
    const states = [sched('w1', { stability: 40, mastery: 'Consolidating' })];
    const req = sessionPlanner.buildRequest(setup, states);
    // examTarget resolves to the internal CEFR pivot; intent/wordTarget/contentType pass through.
    expect(req.level).toBe('B2'); // eiken 準1 → B2
    expect(req.intent).toBe('business');
    expect(req.newWordRatio).toBe(0.3);
    expect(req.wordTarget).toBe(400);
    expect(req.contentType).toBe('article');
    expect(req.readabilityLevel).toBe('standard'); // B2 preset
    expect((req as { themes?: unknown }).themes).toBeUndefined(); // legacy field gone
    // w2 excluded; w1 + w3 remain.
    expect(req.targetWords.map((t) => t.wordId)).toEqual(['w1', 'w3']);
  });

  it('injects the exam sub-band + label into levelDetail for the passage prompt (A-3-1)', () => {
    const req = sessionPlanner.buildRequest(setup, []); // eiken 準1 → B2, grade → mid
    expect(req.levelDetail).toEqual({ subBand: 'mid', examLabel: '英検準1級' });
    const toeic900 = sessionPlanner.buildRequest({ ...setup, examTarget: { kind: 'toeic', value: '900' } }, []);
    expect(toeic900.levelDetail).toEqual({ subBand: 'high', examLabel: 'TOEIC 900' });
  });

  it('lets advanced settings override vocabulary level and sentence-structure readability separately', () => {
    const req = sessionPlanner.buildRequest(
      {
        ...setup,
        advancedDifficulty: { vocabularyLevel: 'C1', readabilityLevel: 'easy' },
      },
      [],
    );
    expect(req.level).toBe('C1');
    expect(req.readabilityLevel).toBe('easy');
  });

  it('passes a story consistency context through untouched when present', () => {
    const storyContext = {
      storyId: 's1',
      chapterIndex: 1,
      plan: {
        storyId: 's1',
        contentType: 'long_story' as const,
        genre: 'fantasy',
        titleJa: '物語',
        synopsisJa: 'あらすじ',
        characters: [],
        chapters: [{ index: 1, headingJa: '第一章', beatJa: 'ビート' }],
      },
      priorSummaryJa: '前章の要約',
    };
    const req = sessionPlanner.buildRequest(
      { ...setup, contentType: 'long_story' },
      [],
      undefined,
      storyContext,
    );
    expect(req.contentType).toBe('long_story');
    expect(req.storyContext).toBe(storyContext);
  });

  it('derives masteryDensity from scheduling state and defaults unknown words to new', () => {
    const states = [sched('w1', { stability: 40, lapses: 0, mastery: 'Consolidating' })];
    const req = sessionPlanner.buildRequest(setup, states);
    const w1 = req.targetWords.find((t) => t.wordId === 'w1')!;
    const w3 = req.targetWords.find((t) => t.wordId === 'w3')!;
    expect(w1.masteryDensity).toBe('known'); // Consolidating → known
    expect(w3.masteryDensity).toBe('new'); // no state → New → new
  });

  it('enriches surface and attributes from supplied word data', () => {
    const word: WordData = {
      wordId: 'w1',
      headword: 'resilient',
      ipa: '',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: { meaningsJa: [], examples: [], collocations: [{ id: 'stay-resilient', pattern: 'stay resilient', type: 'Adv+V', slotExamples: [], glossJa: '', l1Contrast: false }], synonymNuances: [] },
    };
    const req = sessionPlanner.buildRequest(setup, [], { w1: word });
    const w1 = req.targetWords.find((t) => t.wordId === 'w1')!;
    expect(w1.surface).toBe('resilient');
    expect(w1.attributes).toBeDefined();
    expect((w1.attributes as { register: string }).register).toBe('neutral');
  });
});

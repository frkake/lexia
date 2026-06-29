import { describe, it, expect } from 'vitest';
import { contentKeys, generatePassageQuery } from './contentQueries';
import { ok, err } from '../../types/result';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { GenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import type { GenerationRequest, IndexedPassage } from '../../types/domain';

const req: GenerationRequest = {
  level: 'B1',
  themes: ['travel', 'email'],
  newWordRatio: 0.3,
  length: 'short',
  targetWords: [
    { wordId: 'w2', surface: 'b', masteryDensity: 'new' },
    { wordId: 'w1', surface: 'a', masteryDensity: 'new' },
  ],
};

function indexed(): IndexedPassage {
  return tokenizer.index('p1', {
    meta: { title: 't', theme: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 2 },
    sentences: [{ tokens: ['Hello', '.'], translationJa: '' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  });
}

describe('contentKeys', () => {
  it('produces a stable passage key independent of target-word ordering', () => {
    const reordered: GenerationRequest = { ...req, targetWords: [...req.targetWords].reverse() };
    expect(contentKeys.passage(req)).toEqual(contentKeys.passage(reordered));
  });

  it('namespaces word keys by id', () => {
    expect(contentKeys.word('w1')).toEqual(['content', 'word', 'w1']);
  });
});

describe('generatePassageQuery', () => {
  it('returns the indexed passage on success', async () => {
    const orchestrator: GenerationOrchestrator = { generate: async () => ok(indexed()) };
    const passage = await generatePassageQuery(orchestrator, req);
    expect(passage.passageId).toBe('p1');
  });

  it('throws the generation error so the query can retry/surface it', async () => {
    const orchestrator: GenerationOrchestrator = { generate: async () => err({ kind: 'refusal' }) };
    await expect(generatePassageQuery(orchestrator, req)).rejects.toMatchObject({ kind: 'refusal' });
  });
});

import { describe, it, expect } from 'vitest';
import { createGenerationOrchestrator } from './generationOrchestrator';
import type { ContentGateway } from '../../types/ports';
import type { GenerationRequest, GenerationResponse, PassageOutput, StopReason } from '../../types/domain';

const req: GenerationRequest = {
  level: 'B1',
  themes: ['negotiation'],
  newWordRatio: 0.3,
  length: 'medium',
  targetWords: [
    {
      wordId: 'negotiate',
      surface: 'negotiate',
      masteryDensity: 'new',
      attributes: { register: 'business', connotation: 'neutral', core: { collocations: ['negotiate the terms'] } },
    },
  ],
};

function passage(over: Partial<PassageOutput> = {}): PassageOutput {
  return {
    meta: { title: 't', theme: 'negotiation', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 7 },
    sentences: [
      { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'], translationJa: '交渉する。' },
    ],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
    ],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 },
        category: 'register',
        wordId: 'negotiate',
        sourceAttribute: 'register',
        explanationJa: '',
      },
    ],
    ...over,
  };
}

const goodResponse: GenerationResponse = { passage: passage(), stopReason: 'end_turn' };
const invalidResponse: GenerationResponse = {
  passage: passage({
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 3, tokenEnd: 99, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
    ],
  }),
  stopReason: 'end_turn',
};

function queueGateway(responses: GenerationResponse[]): { gateway: ContentGateway; calls: () => number } {
  let i = 0;
  return {
    gateway: {
      generatePassage: async () => responses[Math.min(i++, responses.length - 1)]!,
      getWordData: async () => {
        throw new Error('unused');
      },
    },
    calls: () => i,
  };
}

describe('GenerationOrchestrator', () => {
  it('repairs a failed validation then indexes the successful passage', async () => {
    const { gateway, calls } = queueGateway([invalidResponse, goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passageId).toBe('p1');
      expect(result.value.renderText).toContain('negotiate');
      expect(result.value.tokens.length).toBeGreaterThan(0);
    }
    expect(calls()).toBe(2); // repaired once
  });

  it('returns validation_exhausted with the last report after exceeding repair attempts', async () => {
    const { gateway } = queueGateway([invalidResponse]); // always invalid
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation_exhausted');
      if (result.error.kind === 'validation_exhausted') {
        expect(result.error.lastReport.violations.length).toBeGreaterThan(0);
      }
    }
  });

  it('regenerates on a refusal stop_reason, then succeeds', async () => {
    const refusal: GenerationResponse = { passage: passage(), stopReason: 'refusal' as StopReason };
    const { gateway, calls } = queueGateway([refusal, goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    expect(calls()).toBe(2);
  });

  it('returns a refusal error once regeneration attempts are exhausted', async () => {
    const refusal: GenerationResponse = { passage: passage(), stopReason: 'refusal' as StopReason };
    const { gateway } = queueGateway([refusal]); // always refuses
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRegenerations: 1 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('refusal');
  });

  it('returns a max_tokens error once regeneration attempts are exhausted', async () => {
    const truncated: GenerationResponse = { passage: passage(), stopReason: 'max_tokens' };
    const { gateway } = queueGateway([truncated]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRegenerations: 0 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('max_tokens');
  });
});

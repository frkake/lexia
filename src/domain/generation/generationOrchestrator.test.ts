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

// An 8-word filler sentence, repeated so the passage clears the length gate for `length: 'medium'`.
const FILLER = ['Both', 'sides', 'reviewed', 'the', 'plan', 'in', 'careful', 'detail', '.'];

function passage(over: Partial<PassageOutput> = {}): PassageOutput {
  const sentences = [
    { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'], translationJa: '交渉する。' },
    ...Array.from({ length: 24 }, () => ({ tokens: [...FILLER], translationJa: '両者は計画を詳細に検討した。' })),
  ];
  return {
    meta: { title: 't', theme: 'negotiation', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 198 },
    sentences,
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
        anchorText: 'negotiate',
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

function queueGateway(responses: GenerationResponse[]): {
  gateway: ContentGateway;
  calls: () => number;
  requests: () => GenerationRequest[];
} {
  let i = 0;
  const seen: GenerationRequest[] = [];
  return {
    gateway: {
      generatePassage: async (r) => {
        seen.push(r);
        return responses[Math.min(i++, responses.length - 1)]!;
      },
      getWordData: async () => {
        throw new Error('unused');
      },
    },
    calls: () => i,
    requests: () => seen,
  };
}

describe('GenerationOrchestrator', () => {
  it('repairs a failed validation then indexes the successful passage', async () => {
    const { gateway, calls, requests } = queueGateway([invalidResponse, goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passageId).toBe('p1');
      expect(result.value.renderText).toContain('negotiate');
      expect(result.value.tokens.length).toBeGreaterThan(0);
    }
    expect(calls()).toBe(2); // repaired once
    // The repair attempt is guided: it carries feedback describing the first attempt's violations.
    expect(requests()[0]!.repairFeedback).toBeUndefined();
    expect(requests()[1]!.repairFeedback?.length ?? 0).toBeGreaterThan(0);
  });

  it('drops a single unanchorable notice cue after repairs are exhausted, then accepts', async () => {
    // The passage is valid EXCEPT for one cue whose span ([5,6)="terms") does not render its
    // anchorText ("negotiate") — the badge ↔ explanation drift this feature guards. After the
    // repair budget is spent, the orchestrator should drop just that cue and accept the passage,
    // rather than failing the whole generation over a cue-local marker.
    const cueMismatch: GenerationResponse = {
      passage: passage({
        noticeCues: [
          {
            index: 1,
            span: { sentenceIndex: 0, tokenStart: 5, tokenEnd: 6 }, // "terms", not "negotiate"
            category: 'register',
            wordId: 'negotiate',
            sourceAttribute: 'register',
            anchorText: 'negotiate',
            explanationJa: 'ビジネス寄りの語。',
          },
        ],
      }),
      stopReason: 'end_turn',
    };
    const { gateway, calls } = queueGateway([cueMismatch]); // always the same mismatch
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source.noticeCues).toHaveLength(0); // the mislocated cue was dropped
      expect(result.value.renderText).toContain('negotiate'); // the rest of the passage survives
    }
    expect(calls()).toBe(2); // attempted once, repaired once, THEN dropped (not dropped immediately)
  });

  it('does NOT salvage when a non-cue violation remains after repairs', async () => {
    // A target span out of range is not droppable, so the orchestrator still fails as before.
    const { gateway } = queueGateway([invalidResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('validation_exhausted');
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

  it('enriches the accepted passage with cues from the annotation pass', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async () => [
        { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'idiom', anchorText: 'negotiate', explanationJa: '' },
      ],
    };
    const orch = createGenerationOrchestrator({ gateway: enriched, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source.noticeCues.map((c) => c.category)).toEqual(['idiom']);
    }
  });

  it('degrades (still ships the passage) when the annotation pass throws', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const failing: ContentGateway = {
      ...gateway,
      annotatePassage: async () => {
        throw new Error('annotate down');
      },
    };
    const orch = createGenerationOrchestrator({ gateway: failing, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.renderText).toContain('negotiate');
  });
});

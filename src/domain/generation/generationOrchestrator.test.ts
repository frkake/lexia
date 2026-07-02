import { describe, it, expect } from 'vitest';
import { createGenerationOrchestrator } from './generationOrchestrator';
import { passageValidator } from './passageValidator';
import type { ContentGateway } from '../../types/ports';
import type { GenerationRequest, GenerationResponse, PassageAnnotationRequest, PassageOutput, StopReason } from '../../types/domain';

const req: GenerationRequest = {
  level: 'B1',
  intent: 'business',
  newWordRatio: 0.3,
  wordTarget: 250,
  contentType: 'article',
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
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 198 },
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

  // Requirement 7.4 degrade: a passage that is ONLY out of the length band (body text valid, just
  // short/long) is shipped as a last resort after repairs — a slightly-off length is readable and
  // far better UX than failing the whole generation. This is the residual half of the
  // validation_exhausted trap (the model under-produces below the floor even with enough tokens).
  it('ships an otherwise-valid but under-length passage as a last resort (no validation_exhausted)', async () => {
    // ~14 words vs a 250-word target ⇒ below the [100,400] band, but the target word is present and
    // every span/cue is valid, so length is the ONLY violation.
    const shortPassage: GenerationResponse = {
      passage: {
        meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 14 },
        sentences: [
          { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', 'of', 'the', 'new', 'deal', 'today', '.'], translationJa: '交渉する。' },
        ],
        targetSpans: [
          { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
        ],
        collocationSpans: [],
        noticeCues: [],
      },
      stopReason: 'end_turn',
    };
    const { gateway } = queueGateway([shortPassage]); // always short (repairs can't lengthen it)
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(req); // req.wordTarget = 250 → band [100, 400]
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.renderText).toContain('negotiate');
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

  it('passes the body-mark spans (study words + collocations) to the annotation pass as required coverage', async () => {
    const { gateway } = queueGateway([goodResponse]);
    let captured: PassageAnnotationRequest | null = null;
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async (r) => {
        captured = r;
        return [];
      },
    };
    const orch = createGenerationOrchestrator({ gateway: enriched, passageId: 'p1' });
    await orch.generate(req);
    expect(captured).not.toBeNull();
    expect(captured!.level).toBe('B1');
    expect(captured!.targetSpans).toEqual(goodResponse.passage.targetSpans);
    expect(captured!.collocationSpans).toEqual(goodResponse.passage.collocationSpans);
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

  // ── Requirement 7.4 / 10.2: wordTarget drives the length gate ────────────────
  it('wires wordTarget into the length gate (a tiny passage against a large target is flagged)', async () => {
    // A tiny 3-word passage against a wordTarget of 1500 is far outside the ±LENGTH_WORD_TOLERANCE
    // band, so the validator flags length_out_of_range — proving wordTarget reaches ctx.approxWords.
    const tiny = passage({
      sentences: [{ tokens: ['We', 'negotiate', '.'], translationJa: '交渉する。' }],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
      ],
      noticeCues: [],
    });
    const targets = [{ wordId: 'negotiate', surface: 'negotiate' }];
    // wordTarget=1500 ⇒ band [600, 2400]: a 2-word passage is far below → flagged.
    expect(
      passageValidator.validate(tiny, { level: 'B1', targets, approxWords: 1500 }).violations.some((v) => v.kind === 'length_out_of_range'),
    ).toBe(true);
    // No approxWords ⇒ the gate is skipped entirely (proves it is the target driving it).
    expect(
      passageValidator.validate(tiny, { level: 'B1', targets }).violations.some((v) => v.kind === 'length_out_of_range'),
    ).toBe(false);
  });

  it('ships (does not hard-fail) a length-only-invalid passage as a last resort', async () => {
    // Same tiny passage: length is the ONLY violation, so after repairs it is shipped, not errored.
    const tiny: GenerationResponse = {
      passage: passage({
        sentences: [{ tokens: ['We', 'negotiate', '.'], translationJa: '交渉する。' }],
        targetSpans: [
          { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
        ],
        noticeCues: [],
      }),
      stopReason: 'end_turn',
    };
    const { gateway } = queueGateway([tiny]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 0 });
    const result = await orch.generate({ ...req, wordTarget: 1500 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.renderText).toContain('negotiate');
  });

  // ── Requirement 6.6 / 10.2: story consistency context flows through untouched ─
  it('passes the request storyContext through to the gateway without altering the loop', async () => {
    const { gateway, requests } = queueGateway([goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const storyContext = {
      storyId: 's1',
      chapterIndex: 2,
      plan: {
        storyId: 's1',
        contentType: 'long_story' as const,
        genre: 'fantasy',
        titleJa: '物語',
        synopsisJa: 'あらすじ',
        characters: [],
        chapters: [{ index: 2, headingJa: '第二章', beatJa: 'ビート' }],
      },
      priorSummaryJa: '前章の要約',
    };
    const result = await orch.generate({ ...req, contentType: 'long_story', storyContext });
    expect(result.ok).toBe(true);
    expect(requests()[0]!.storyContext).toBe(storyContext);
  });
});

import { describe, it, expect } from 'vitest';
import { createGenerationOrchestrator } from './generationOrchestrator';
import { passageValidator } from './passageValidator';
import type { ContentGateway } from '../../types/ports';
import type { Cefr, GenerationRequest, GenerationResponse, PassageAnnotationRequest, PassageOutput, StopReason } from '../../types/domain';

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

/**
 * A ~215-word passage (clears the [100,400] band for wordTarget 250) that weaves the target word
 * into its collocation and carries the given self-reported expressions. `exprs` controls whether the
 * idiom/set-phrase quotas (2 each at 250 words) are met.
 */
function qualityPassage(exprs: PassageOutput['expressionSpans']): PassageOutput {
  const sentences = [
    { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'], translationJa: '交渉する。' },
    { tokens: ['We', 'come', 'up', 'with', 'a', 'plan', 'in', 'the', 'long', 'run', '.'], translationJa: '' },
    { tokens: ['Please', 'find', 'attached', 'the', 'file', ',', 'moving', 'forward', '.'], translationJa: '' },
    ...Array.from({ length: 24 }, () => ({ tokens: [...FILLER], translationJa: '両者は計画を詳細に検討した。' })),
  ];
  return {
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 215 },
    sentences,
    targetSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' }],
    collocationSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 6, headWordId: 'negotiate', collocationId: 'negotiate the terms' }],
    noticeCues: [],
    expressionSpans: exprs,
  };
}

const ALL_EXPRESSIONS: PassageOutput['expressionSpans'] = [
  { span: { sentenceIndex: 1, tokenStart: 1, tokenEnd: 4 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '' },
  { span: { sentenceIndex: 1, tokenStart: 6, tokenEnd: 10 }, surface: 'in the long run', category: 'idiom', meaningJa: '' },
  { span: { sentenceIndex: 2, tokenStart: 0, tokenEnd: 3 }, surface: 'Please find attached', category: 'set_phrase', meaningJa: '' },
  { span: { sentenceIndex: 2, tokenStart: 6, tokenEnd: 8 }, surface: 'moving forward', category: 'set_phrase', meaningJa: '' },
];
const UNDER_QUOTA_EXPRESSIONS: PassageOutput['expressionSpans'] = [ALL_EXPRESSIONS![0]!];

/**
 * A single chunked-segment passage of ~`6 + fillerCount*8` words with the target woven into sentence 0
 * (so each merged segment carries a valid targetSpan). No expressionSpans ⇒ the B-1/B-2 quality gates
 * are skipped, keeping the merged body's only possible fault the length band.
 */
function chunkPassage(fillerCount: number): PassageOutput {
  return {
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 6 + fillerCount * 8 },
    sentences: [
      { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'], translationJa: 'チームは条件を交渉した。' },
      ...Array.from({ length: fillerCount }, () => ({ tokens: [...FILLER], translationJa: '両者は計画を詳細に検討した。' })),
    ],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
    ],
    collocationSpans: [],
    noticeCues: [],
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

  // ── B-5 第2弾: chunked generation for targets above the single-request ceiling ──
  it('splits a large target into sequential segments, concatenates them, and validates the merged body once', async () => {
    // wordTarget 3000 > 1600 ⇒ ceil(3000 / 1200) = 3 segments of round(3000/3)=1000 words each. Each
    // ~998-word segment concatenates to ~2994 words, inside the ±25% band [2250, 3750] for a 3000 target.
    const seg: GenerationResponse = { passage: chunkPassage(124), stopReason: 'end_turn' };
    const { gateway, calls, requests } = queueGateway([seg, seg, seg]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate({ ...req, wordTarget: 3000, contentType: 'short_story' });
    expect(result.ok).toBe(true);
    expect(calls()).toBe(3); // one call per segment
    // Every segment asked for the per-segment target, not the full 3000.
    expect(requests().map((r) => r.wordTarget)).toEqual([1000, 1000, 1000]);
    if (result.ok) {
      // The concatenated body carries all three woven-in target spans, re-indexed to their merged
      // sentence positions, and the merged length is in-band ⇒ no lengthShortfall recorded.
      expect(result.value.source.targetSpans).toHaveLength(3);
      const words = result.value.source.sentences.reduce(
        (n, s) => n + s.tokens.filter((t) => /[a-zA-Z]/.test(t)).length,
        0,
      );
      expect(words).toBeGreaterThanOrEqual(2250);
      expect(words).toBeLessThanOrEqual(3750);
      expect(result.value.source.meta.lengthShortfall).toBeUndefined();
    }
  });

  it('passes each later segment a continuation summary of the prose so far (context continuity)', async () => {
    const seg: GenerationResponse = { passage: chunkPassage(124), stopReason: 'end_turn' };
    const { gateway, requests } = queueGateway([seg, seg, seg]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    await orch.generate({ ...req, wordTarget: 3000, contentType: 'short_story' });
    const ccs = requests().map((r) => r.continuationContext);
    expect(ccs.every((c) => c !== undefined)).toBe(true);
    expect(ccs.map((c) => c!.segmentIndex)).toEqual([0, 1, 2]);
    expect(ccs.every((c) => c!.segmentCount === 3)).toBe(true);
    // The opening segment has no prior prose; later segments carry a non-empty Japanese tail summary.
    expect(ccs[0]!.priorSummaryJa).toBe('');
    expect(ccs[1]!.priorSummaryJa.length).toBeGreaterThan(0);
    expect(ccs[2]!.priorSummaryJa.length).toBeGreaterThan(0);
  });

  it('rescues a partial run: ships the produced prefix with a recorded length shortfall when a later segment fails', async () => {
    // Segment 0 lands; segment 1 refuses with the regeneration budget already spent ⇒ the run stops and
    // the ~998-word prefix is shipped (far below the 3000 band) with meta.lengthShortfall recorded,
    // rather than losing the whole generation.
    const seg: GenerationResponse = { passage: chunkPassage(124), stopReason: 'end_turn' };
    const refusal: GenerationResponse = { passage: chunkPassage(124), stopReason: 'refusal' as StopReason };
    const { gateway, calls } = queueGateway([seg, refusal]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRegenerations: 0 });
    const result = await orch.generate({ ...req, wordTarget: 3000, contentType: 'short_story' });
    expect(result.ok).toBe(true);
    expect(calls()).toBe(2); // segment 0 (ok) + segment 1 (refused, no regen budget)
    if (result.ok) {
      const shortfall = result.value.source.meta.lengthShortfall;
      expect(shortfall).toBeDefined();
      expect(shortfall!.requested).toBe(3000);
      expect(shortfall!.actual).toBeLessThan(2250);
      expect(result.value.renderText).toContain('negotiate'); // still a readable passage
    }
  });

  it('surfaces the error when the very first segment fails (nothing to rescue)', async () => {
    const refusal: GenerationResponse = { passage: chunkPassage(124), stopReason: 'refusal' as StopReason };
    const { gateway } = queueGateway([refusal]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRegenerations: 0 });
    const result = await orch.generate({ ...req, wordTarget: 3000, contentType: 'short_story' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('refusal');
  });

  it('records meta.lengthShortfall on a single-shot length-only ship (requested vs actual)', async () => {
    // A tiny body against a 1500-word (single-shot) target is shipped as a length residual; the
    // shortfall must be stamped so the reader can surface「指定 1500 語 / 実際 N 語」.
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
    if (result.ok) {
      const shortfall = result.value.source.meta.lengthShortfall;
      expect(shortfall).toEqual({ requested: 1500, actual: 2 });
    }
  });

  it('does not stamp effectiveWordTarget when no truncation occurs', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source.meta.effectiveWordTarget).toBeUndefined();
  });

  it('enriches the accepted passage with cues from the annotation pass', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async () => ({
        noticeCues: [
          { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'idiom', anchorText: 'negotiate', explanationJa: '' },
        ],
        status: 'complete',
      }),
    };
    const orch = createGenerationOrchestrator({ gateway: enriched, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source.noticeCues.map((c) => c.category)).toEqual(['idiom']);
      // A clean pass is recorded as complete so the reader shows no failure banner.
      expect(result.value.source.meta.annotationStatus).toBe('complete');
    }
  });

  it('records annotationStatus=failed when the pass reports failure (F-6, no silent loss)', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const failed: ContentGateway = {
      ...gateway,
      annotatePassage: async () => ({ noticeCues: [], status: 'failed' }),
    };
    const orch = createGenerationOrchestrator({ gateway: failed, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source.noticeCues).toHaveLength(0);
      expect(result.value.source.meta.annotationStatus).toBe('failed');
    }
  });

  it('passes the body-mark spans (study words + collocations) to the annotation pass as required coverage', async () => {
    const { gateway } = queueGateway([goodResponse]);
    let captured: PassageAnnotationRequest | null = null;
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async (r) => {
        captured = r;
        return { noticeCues: [], status: 'complete' };
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
    if (result.ok) {
      expect(result.value.renderText).toContain('negotiate');
      // A thrown annotation call is recorded as failed (not silently absent) so the reader can recover.
      expect(result.value.source.meta.annotationStatus).toBe('failed');
    }
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

  // ── B-4: the accepted passage records its measured CEFR vocabulary profile ──────
  it('stamps meta.vocabProfile from the accepting report when a cefrOf dictionary is injected', async () => {
    const bands: Record<string, Cefr> = {
      the: 'A2', team: 'A2', both: 'A2', sides: 'A2', plan: 'A2', detail: 'A2', careful: 'A2', negotiate: 'C1',
    };
    const cefrOf = (t: string): Cefr | undefined => bands[t];
    const { gateway } = queueGateway([goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, cefrOf, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const profile = result.value.source.meta.vocabProfile;
      expect(profile).toBeDefined();
      // Many A2 tokens + one C1 token (`negotiate`) at level B1 ⇒ a small but non-zero off-band ratio.
      expect(profile!.sampleSize).toBeGreaterThan(0);
      expect(profile!.offBandRatio).toBeGreaterThan(0);
      expect(profile!.offBandRatio).toBeLessThan(0.15);
    }
  });

  it('omits meta.vocabProfile when no cefrOf dictionary is injected (back-compat)', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source.meta.vocabProfile).toBeUndefined();
  });

  // ── B-1 / B-2: expression quota → repair → qualityWarnings residual ──────────
  it('feeds an under-quota expression violation back into repairFeedback, then accepts the fixed passage', async () => {
    const under: GenerationResponse = { passage: qualityPassage(UNDER_QUOTA_EXPRESSIONS), stopReason: 'end_turn' };
    const meets: GenerationResponse = { passage: qualityPassage(ALL_EXPRESSIONS), stopReason: 'end_turn' };
    const { gateway, calls, requests } = queueGateway([under, meets]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    expect(calls()).toBe(2); // repaired once
    // The repair attempt carries the expression-quota hint.
    expect(requests()[1]!.repairFeedback?.some((f) => f.includes('expressionSpans'))).toBe(true);
    if (result.ok) expect(result.value.source.meta.qualityWarnings).toBeUndefined(); // the fixed pass is clean
  });

  it('ships an under-quota passage with meta.qualityWarnings once the repair budget is spent (never hard-fails)', async () => {
    const under: GenerationResponse = { passage: qualityPassage(UNDER_QUOTA_EXPRESSIONS), stopReason: 'end_turn' };
    const { gateway } = queueGateway([under]); // always under quota (repairs cannot fix it)
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const warnings = result.value.source.meta.qualityWarnings;
      expect(warnings).toBeDefined();
      expect(warnings!.length).toBeGreaterThan(0);
      expect(result.value.renderText).toContain('negotiate'); // still a readable passage
    }
  });

  // ── B-3: advanced sentence-length / syntax-repertoire residual ships with qualityWarnings ──
  it('ships an advanced passage that misses the sentence-length + syntax gates with meta.qualityWarnings (never hard-fails)', async () => {
    const advancedReq: GenerationRequest = { ...req, level: 'C1' }; // C1 ⇒ readabilityLevel 'advanced'
    // Short single-clause sentences + an empty syntaxSpans self-report ⇒ both B-3 gates fire, but they
    // are quality-level, so the passage still ships (with warnings) rather than validation_exhausted.
    const short: GenerationResponse = { passage: passage({ syntaxSpans: [] }), stopReason: 'end_turn' };
    const { gateway } = queueGateway([short]);
    const orch = createGenerationOrchestrator({ gateway, passageId: 'p1', maxRepairs: 1 });
    const result = await orch.generate(advancedReq);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const warnings = result.value.source.meta.qualityWarnings;
      expect(warnings).toBeDefined();
      expect(warnings!.some((w) => w.includes('readability band') || w.includes('required constructions'))).toBe(true);
      expect(result.value.renderText).toContain('negotiate'); // still a readable passage
    }
  });

  it('passes the self-reported expressionSpans to the annotation pass as required coverage', async () => {
    const good: GenerationResponse = { passage: qualityPassage(ALL_EXPRESSIONS), stopReason: 'end_turn' };
    const { gateway } = queueGateway([good]);
    let captured: PassageAnnotationRequest | null = null;
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async (r) => {
        captured = r;
        return { noticeCues: [], status: 'complete' };
      },
    };
    const orch = createGenerationOrchestrator({ gateway: enriched, passageId: 'p1' });
    await orch.generate(req);
    expect(captured!.expressionSpans?.map((e) => e.surface)).toContain('come up with');
  });
});

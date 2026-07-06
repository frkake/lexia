import { describe, it, expect } from 'vitest';
import { passageValidator } from './passageValidator';
import type { ValidationContext } from './passageValidator';
import type { PassageOutput } from '../../types/domain';

function basePassage(over: Partial<PassageOutput> = {}): PassageOutput {
  return {
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 7 },
    sentences: [
      { tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'], translationJa: 'チームは条件を交渉する。' },
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
        anchorText: 'negotiate',
        explanationJa: 'ビジネス寄りの語。',
      },
    ],
    ...over,
  };
}

const ctx: ValidationContext = {
  level: 'B1',
  targets: [
    {
      wordId: 'negotiate',
      surface: 'negotiate',
      attributes: {
        register: 'business',
        connotation: 'neutral',
        core: { collocations: ['negotiate the terms'] },
      },
    },
  ],
};

describe('PassageValidator', () => {
  it('passes a well-formed passage', () => {
    const report = passageValidator.validate(basePassage(), ctx);
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
    expect(report.cefrOffBandRatio).toBe(0);
  });

  it('detects out-of-range spans', () => {
    const report = passageValidator.validate(
      basePassage({
        targetSpans: [
          { sentenceIndex: 0, tokenStart: 3, tokenEnd: 99, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'new' },
        ],
      }),
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.kind === 'span_out_of_range')).toBe(true);
  });

  it('detects a surface that is not an inflection of the target word', () => {
    const report = passageValidator.validate(
      basePassage({
        // declared surface matches the tokens, but is not an inflection of "negotiate".
        sentences: [
          { tokens: ['The', 'team', 'likes', 'apples', 'and', 'terms', '.'], translationJa: '' },
        ],
        targetSpans: [
          { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'apples', masteryDensity: 'new' },
        ],
        noticeCues: [],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'surface_mismatch')).toBe(true);
  });

  it('accepts inflected surfaces of the target word', () => {
    const report = passageValidator.validate(
      basePassage({
        sentences: [
          { tokens: ['They', 'are', 'negotiating', 'hard', 'today', 'now', '.'], translationJa: '' },
        ],
        targetSpans: [
          { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'negotiate', surface: 'negotiating', masteryDensity: 'new' },
        ],
        noticeCues: [],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'surface_mismatch')).toBe(false);
  });

  it('detects a notice cue whose sourceAttribute is not present in supplied attributes', () => {
    const report = passageValidator.validate(
      basePassage({
        noticeCues: [
          {
            index: 1,
            span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 },
            category: 'word_family',
            wordId: 'negotiate',
            sourceAttribute: 'more.wordFamily', // not supplied in ctx attributes
            anchorText: 'negotiate',
            explanationJa: '派生語。',
          },
        ],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'cue_unattested')).toBe(true);
  });

  it('detects a notice cue whose category does not match its sourceAttribute', () => {
    const report = passageValidator.validate(
      basePassage({
        noticeCues: [
          {
            index: 1,
            span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 },
            category: 'register',
            wordId: 'negotiate',
            sourceAttribute: 'connotation', // exists, but is the connotation attribute, not register
            anchorText: 'negotiate',
            explanationJa: '',
          },
        ],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'cue_category_mismatch')).toBe(true);
  });

  it('detects a notice cue whose span does not render its declared anchorText', () => {
    // anchorText says the note is about "negotiate", but the span points at "terms" (tokens [5,6)).
    // This is the badge ↔ explanation drift the feature guards: the marker would sit on the wrong word.
    const report = passageValidator.validate(
      basePassage({
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
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.kind === 'cue_surface_mismatch')).toBe(true);
  });

  it('accepts a notice cue whose span renders exactly its anchorText (multi-token)', () => {
    const report = passageValidator.validate(
      basePassage({
        noticeCues: [
          {
            index: 1,
            span: { sentenceIndex: 0, tokenStart: 4, tokenEnd: 6 }, // "the terms"
            category: 'collocation',
            wordId: 'negotiate',
            sourceAttribute: 'core.collocations',
            anchorText: 'the terms',
            explanationJa: 'negotiate the terms の定型。',
          },
        ],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'cue_surface_mismatch')).toBe(false);
  });

  it('does not flag an annotation cue that omits wordId/sourceAttribute (location-only grounding)', () => {
    const report = passageValidator.validate(
      basePassage({
        // No wordId / sourceAttribute (an exhaustive annotation-pass cue). span renders "negotiate".
        noticeCues: [
          { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'idiom', anchorText: 'negotiate', explanationJa: '' },
        ],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'cue_unattested' || v.kind === 'cue_category_mismatch')).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('flags passages whose out-of-band token ratio exceeds tolerance', () => {
    const report = passageValidator.validate(
      basePassage({
        sentences: [
          { tokens: ['Esoteric', 'pejorative', 'ubiquitous', 'negotiate', 'the', 'terms', '.'], translationJa: '' },
        ],
        noticeCues: [],
      }),
      {
        ...ctx,
        cefrOf: (t) =>
          ({ esoteric: 'C2', pejorative: 'C2', ubiquitous: 'C1', negotiate: 'B1', terms: 'A2', the: 'A2' } as const)[
            t
          ],
      },
    );
    expect(report.cefrOffBandRatio).toBeGreaterThan(0.15);
    expect(report.violations.some((v) => v.kind === 'cefr_out_of_band')).toBe(true);
  });

  it('flags a passage far shorter than the requested length', () => {
    const report = passageValidator.validate(basePassage(), { ...ctx, approxWords: 250 });
    expect(report.violations.some((v) => v.kind === 'length_out_of_range')).toBe(true);
  });

  it('flags a passage far longer than the requested length', () => {
    const report = passageValidator.validate(basePassage(), { ...ctx, approxWords: 2 });
    expect(report.violations.some((v) => v.kind === 'length_out_of_range')).toBe(true);
  });

  it('accepts a passage whose length is within the band', () => {
    const report = passageValidator.validate(basePassage(), { ...ctx, approxWords: 8 });
    expect(report.violations.some((v) => v.kind === 'length_out_of_range')).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('skips the length gate when approxWords is absent', () => {
    const report = passageValidator.validate(basePassage(), ctx);
    expect(report.violations.some((v) => v.kind === 'length_out_of_range')).toBe(false);
  });

  describe('translation-side new-element consistency (4.2/4.4)', () => {
    it('flags a JA span flagged isNew whose linked target is NOT a new word', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [
            {
              tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'],
              translationJa: 'チームは条件を交渉する。',
              // "交渉" is flagged new, but the target "negotiate" is a REVIEW word below.
              translationSpans: [{ charStart: 5, charEnd: 7, refType: 'word', wordId: 'negotiate', isNew: true }],
            },
          ],
          targetSpans: [
            { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'review' },
          ],
          noticeCues: [],
        }),
        ctx,
      );
      expect(report.ok).toBe(false);
      const v = report.violations.find((x) => x.kind === 'translation_span_mismatch');
      expect(v).toBeTruthy();
      // The violation identifies the offending span so the orchestrator can drop just it.
      expect(v!.translationSpan).toMatchObject({ sentenceIndex: 0, charStart: 5, charEnd: 7 });
    });

    it('accepts a JA span flagged isNew whose linked target IS a new word', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [
            {
              tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'],
              translationJa: 'チームは条件を交渉する。',
              translationSpans: [{ charStart: 5, charEnd: 7, refType: 'word', wordId: 'negotiate', isNew: true }],
            },
          ],
          // target density is 'new' (matches basePassage default)
          noticeCues: [],
        }),
        ctx,
      );
      expect(report.violations.some((x) => x.kind === 'translation_span_mismatch')).toBe(false);
    });

    it('does not flag a non-new JA span (isNew false) even when its target is a review word', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [
            {
              tokens: ['The', 'team', 'will', 'negotiate', 'the', 'terms', '.'],
              translationJa: 'チームは条件を交渉する。',
              translationSpans: [{ charStart: 5, charEnd: 7, refType: 'word', wordId: 'negotiate', isNew: false }],
            },
          ],
          targetSpans: [
            { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'negotiate', surface: 'negotiate', masteryDensity: 'review' },
          ],
          noticeCues: [],
        }),
        ctx,
      );
      expect(report.violations.some((x) => x.kind === 'translation_span_mismatch')).toBe(false);
    });

    it('passes a passage with no translation spans (back-compat)', () => {
      const report = passageValidator.validate(basePassage(), ctx);
      expect(report.violations.some((x) => x.kind === 'translation_span_mismatch')).toBe(false);
      expect(report.ok).toBe(true);
    });
  });

  // ── B-1 / B-2: self-reported expressions + collocation coverage ────────────
  describe('expression quotas and collocation coverage (B-1/B-2)', () => {
    // Two sentences carrying two idioms/phrasal verbs and two set phrases; approxWords=17 keeps the
    // length gate happy and the quotas at their floor of 2 each.
    function exprPassage(over: Partial<PassageOutput> = {}): PassageOutput {
      return {
        meta: { title: 't', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 17 },
        sentences: [
          { tokens: ['They', 'come', 'up', 'with', 'a', 'plan', 'in', 'the', 'long', 'run', '.'], translationJa: '' },
          { tokens: ['Please', 'find', 'attached', 'the', 'file', ',', 'moving', 'forward', '.'], translationJa: '' },
        ],
        targetSpans: [],
        collocationSpans: [],
        noticeCues: [],
        expressionSpans: [
          { span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '' },
          { span: { sentenceIndex: 0, tokenStart: 6, tokenEnd: 10 }, surface: 'in the long run', category: 'idiom', meaningJa: '' },
          { span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 3 }, surface: 'Please find attached', category: 'set_phrase', meaningJa: '' },
          { span: { sentenceIndex: 1, tokenStart: 6, tokenEnd: 8 }, surface: 'moving forward', category: 'set_phrase', meaningJa: '' },
        ],
        ...over,
      };
    }
    const exprCtx: ValidationContext = { level: 'B2', targets: [], approxWords: 17 };

    it('accepts a passage that meets both the idiom and set-phrase quotas', () => {
      const report = passageValidator.validate(exprPassage(), exprCtx);
      expect(report.violations.some((v) => v.kind === 'expression_quota_unmet')).toBe(false);
      expect(report.ok).toBe(true);
    });

    it('flags expression_quota_unmet when idioms/set phrases fall below quota', () => {
      const report = passageValidator.validate(
        exprPassage({
          expressionSpans: [
            { span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '' },
          ],
        }),
        exprCtx,
      );
      // 1 idiom/phrasal (< 2) and 0 set phrases (< 2) ⇒ two quota violations.
      expect(report.violations.filter((v) => v.kind === 'expression_quota_unmet')).toHaveLength(2);
      expect(report.ok).toBe(false);
    });

    it('flags expression_span_mismatch when a surface does not render its tokens', () => {
      const report = passageValidator.validate(
        exprPassage({
          expressionSpans: [
            { span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 }, surface: 'totally wrong', category: 'idiom', meaningJa: '' },
          ],
        }),
        exprCtx,
      );
      expect(report.violations.some((v) => v.kind === 'expression_span_mismatch')).toBe(true);
    });

    it('skips the expression/collocation gates entirely when expressionSpans is absent (back-compat)', () => {
      // A target with supplied collocations but no collocationSpan would be collocation_missing IF the
      // gate ran — but with no expressionSpans field it is a pre-batch-1 passage, so the gate is off.
      const report = passageValidator.validate(basePassage(), ctx);
      expect(report.violations.some((v) => v.kind === 'collocation_missing')).toBe(false);
      expect(report.ok).toBe(true);
    });

    it('flags collocation_missing when a target with supplied collocations has no collocationSpan', () => {
      const collCtx: ValidationContext = {
        level: 'B2',
        targets: [{ wordId: 'leverage', surface: 'leverage', attributes: { core: { collocations: ['leverage our reputation'] } } }],
        approxWords: 17,
      };
      const report = passageValidator.validate(exprPassage(), collCtx); // collocationSpans: []
      expect(report.violations.some((v) => v.kind === 'collocation_missing')).toBe(true);
    });

    describe('collocation_id fidelity (D4 id ⇄ legacy-string fallback)', () => {
      function collCtxWith(collocations: unknown[]): ValidationContext {
        return {
          level: 'B2',
          targets: [{ wordId: 'leverage', surface: 'leverage', attributes: { core: { collocations } } }],
          approxWords: 17,
        };
      }
      const withColl = (collocationId: string): PassageOutput =>
        exprPassage({ collocationSpans: [{ sentenceIndex: 0, tokenStart: 0, tokenEnd: 3, headWordId: 'leverage', collocationId }] });

      it('accepts a collocationId matching a structured entry id', () => {
        const report = passageValidator.validate(
          withColl('leverage-reputation'),
          collCtxWith([{ id: 'leverage-reputation', text: 'leverage our reputation' }]),
        );
        expect(report.violations.some((v) => v.kind === 'collocation_id_unknown')).toBe(false);
        expect(report.violations.some((v) => v.kind === 'collocation_missing')).toBe(false);
      });

      it('accepts a collocationId matching a legacy plain-string collocation', () => {
        const report = passageValidator.validate(
          withColl('leverage our reputation'),
          collCtxWith(['leverage our reputation']),
        );
        expect(report.violations.some((v) => v.kind === 'collocation_id_unknown')).toBe(false);
      });

      it('flags collocation_id_unknown when the id matches neither an entry id nor a legacy string', () => {
        const report = passageValidator.validate(
          withColl('invented-collocation'),
          collCtxWith(['leverage our reputation']),
        );
        expect(report.violations.some((v) => v.kind === 'collocation_id_unknown')).toBe(true);
      });
    });

    describe('paragraphIndex monotonicity (F-8②)', () => {
      const paragraphs = (a: number, b: number): PassageOutput =>
        exprPassage({
          sentences: [
            { tokens: ['They', 'come', 'up', 'with', 'a', 'plan', 'in', 'the', 'long', 'run', '.'], translationJa: '', paragraphIndex: a },
            { tokens: ['Please', 'find', 'attached', 'the', 'file', ',', 'moving', 'forward', '.'], translationJa: '', paragraphIndex: b },
          ],
        });

      it('accepts a non-decreasing paragraphIndex starting at 0', () => {
        expect(passageValidator.validate(paragraphs(0, 1), exprCtx).violations.some((v) => v.kind === 'paragraph_index_invalid')).toBe(false);
        expect(passageValidator.validate(paragraphs(0, 0), exprCtx).violations.some((v) => v.kind === 'paragraph_index_invalid')).toBe(false);
      });

      it('flags a paragraphIndex that does not start at 0 or that decreases', () => {
        expect(passageValidator.validate(paragraphs(1, 2), exprCtx).violations.some((v) => v.kind === 'paragraph_index_invalid')).toBe(true);
        expect(passageValidator.validate(paragraphs(0, -1), exprCtx).violations.some((v) => v.kind === 'paragraph_index_invalid')).toBe(true);
      });

      it('skips the check when paragraphIndex is absent on some sentences (back-compat)', () => {
        const report = passageValidator.validate(exprPassage(), exprCtx); // no paragraphIndex at all
        expect(report.violations.some((v) => v.kind === 'paragraph_index_invalid')).toBe(false);
      });
    });
  });

  // ── Requirement 6.5 / 9.4: homage verbatim-copy guard ──────────────────────
  describe('verbatim_copy (homage copyright guard)', () => {
    const homageCtx: ValidationContext = {
      ...ctx,
      homageReference: 'It was the best of times it was the worst of times we had everything before us',
    };

    it('flags a long verbatim run copied from the homage reference', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [
            {
              tokens: ['It', 'was', 'the', 'best', 'of', 'times', 'it', 'was', 'the', 'worst', 'of', 'times', '.'],
              translationJa: '最高の時代であり最悪の時代だった。',
            },
          ],
          targetSpans: [],
          noticeCues: [],
        }),
        homageCtx,
      );
      expect(report.ok).toBe(false);
      expect(report.violations.some((v) => v.kind === 'verbatim_copy')).toBe(true);
    });

    it('does not flag a passage that only shares short incidental phrases with the reference', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [
            { tokens: ['It', 'was', 'a', 'calm', 'and', 'ordinary', 'morning', 'downtown', '.'], translationJa: '穏やかな朝だった。' },
          ],
          targetSpans: [],
          noticeCues: [],
        }),
        homageCtx,
      );
      expect(report.violations.some((v) => v.kind === 'verbatim_copy')).toBe(false);
    });

    it('never flags verbatim copy when no homage reference is supplied (articles/originals)', () => {
      const report = passageValidator.validate(basePassage(), ctx);
      expect(report.violations.some((v) => v.kind === 'verbatim_copy')).toBe(false);
    });
  });

  describe('B-3 sentence-length profile + advanced-syntax repertoire', () => {
    // A ~5-word single-clause sentence.
    const shortSentence = () => ({ tokens: ['The', 'team', 'meets', 'each', 'day', '.'], translationJa: '毎日会う。' });
    // A ~20-word sentence (words only, excluding the period).
    const longSentence = {
      tokens: [
        'The', 'committee', 'carefully', 'reviewed', 'the', 'detailed', 'proposal', 'before', 'the',
        'board', 'finally', 'approved', 'the', 'ambitious', 'plan', 'for', 'the', 'coming', 'fiscal', 'year', '.',
      ],
      translationJa: '委員会は提案を検討し理事会が計画を承認した。',
    };
    const syntaxCtx = (readabilityLevel: 'easy' | 'standard' | 'advanced'): ValidationContext => ({
      level: 'C1',
      targets: [],
      readabilityLevel,
    });

    it('flags both gates for an advanced request written as all short single clauses with no syntax self-report', () => {
      const report = passageValidator.validate(
        basePassage({ sentences: Array.from({ length: 6 }, shortSentence), targetSpans: [], noticeCues: [], syntaxSpans: [] }),
        syntaxCtx('advanced'),
      );
      expect(report.violations.some((v) => v.kind === 'sentence_length_profile_mismatch')).toBe(true);
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(true);
    });

    it('flags sentence_length_profile_mismatch for an easy request with ~20-word sentences, but not the syntax gate', () => {
      const report = passageValidator.validate(
        basePassage({ sentences: [longSentence, longSentence], targetSpans: [], noticeCues: [], syntaxSpans: [] }),
        syntaxCtx('easy'),
      );
      expect(report.violations.some((v) => v.kind === 'sentence_length_profile_mismatch')).toBe(true);
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(false);
    });

    it('accepts an advanced passage that hits the length band and self-reports ≥3 distinct required constructions', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [longSentence, longSentence, longSentence],
          targetSpans: [],
          noticeCues: [],
          syntaxSpans: [
            { sentenceIndex: 0, pattern: 'nonrestrictive_relative', anchorText: 'the detailed proposal', noteJa: '非制限関係詞。' },
            { sentenceIndex: 1, pattern: 'participial', anchorText: 'carefully reviewed', noteJa: '分詞構文。' },
            { sentenceIndex: 2, pattern: 'appositive', anchorText: 'the ambitious plan', noteJa: '同格。' },
          ],
        }),
        syntaxCtx('advanced'),
      );
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(false);
      expect(report.violations.some((v) => v.kind === 'sentence_length_profile_mismatch')).toBe(false);
    });

    it('flags syntax_repertoire_unmet when a self-reported anchor is not verbatim in its sentence', () => {
      const report = passageValidator.validate(
        basePassage({
          sentences: [longSentence, longSentence, longSentence],
          targetSpans: [],
          noticeCues: [],
          syntaxSpans: [
            { sentenceIndex: 0, pattern: 'nonrestrictive_relative', anchorText: 'the detailed proposal', noteJa: '' },
            { sentenceIndex: 1, pattern: 'participial', anchorText: 'carefully reviewed', noteJa: '' },
            { sentenceIndex: 2, pattern: 'appositive', anchorText: 'a clause that never appears', noteJa: '' },
          ],
        }),
        syntaxCtx('advanced'),
      );
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(true);
    });

    it('skips the B-3 gates entirely on pre-B-3 passages (no syntaxSpans field)', () => {
      const report = passageValidator.validate(
        basePassage({ sentences: Array.from({ length: 6 }, shortSentence), targetSpans: [], noticeCues: [] }),
        syntaxCtx('advanced'),
      );
      expect(report.violations.some((v) => v.kind === 'sentence_length_profile_mismatch')).toBe(false);
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(false);
    });

    it('skips the B-3 gates when no readabilityLevel is supplied', () => {
      const report = passageValidator.validate(
        basePassage({ sentences: Array.from({ length: 6 }, shortSentence), targetSpans: [], noticeCues: [], syntaxSpans: [] }),
        { level: 'C1', targets: [] },
      );
      expect(report.violations.some((v) => v.kind === 'sentence_length_profile_mismatch')).toBe(false);
      expect(report.violations.some((v) => v.kind === 'syntax_repertoire_unmet')).toBe(false);
    });
  });
});

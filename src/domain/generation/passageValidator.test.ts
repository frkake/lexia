import { describe, it, expect } from 'vitest';
import { passageValidator } from './passageValidator';
import type { ValidationContext } from './passageValidator';
import type { PassageOutput } from '../../types/domain';

function basePassage(over: Partial<PassageOutput> = {}): PassageOutput {
  return {
    meta: { title: 't', theme: 'negotiation', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 7 },
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
});

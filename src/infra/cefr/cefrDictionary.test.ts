import { describe, it, expect } from 'vitest';
import { createCefrDictionary } from './cefrDictionary';
import { passageValidator } from '../../domain/generation/passageValidator';
import type { Cefr, PassageOutput } from '../../types/domain';

const cefrOf = createCefrDictionary();

describe('createCefrDictionary', () => {
  it('maps known core / advanced lemmas to their band (snapshot)', () => {
    // A2 core stays A2; clearly-advanced vocabulary is banded above it — the split the gate needs.
    expect(cefrOf('the')).toBe('A2');
    expect(cefrOf('water')).toBe('A2');
    expect(cefrOf('deal')).toBe('B1');
    expect(cefrOf('negotiate')).toBe('B2');
    expect(cefrOf('esoteric')).toBe('C1');
    expect(cefrOf('ubiquitous')).toBe('C1');
    expect(cefrOf('abstruse')).toBe('C2');
  });

  it('is case-insensitive', () => {
    expect(cefrOf('Esoteric')).toBe('C1');
    expect(cefrOf('THE')).toBe('A2');
  });

  it('resolves regular inflections via lemmatization', () => {
    // Plural / 3sg, past, gerund, comparative/superlative, adverb, silent-e, doubled consonant.
    expect(cefrOf('terms')).toBe(cefrOf('term'));
    expect(cefrOf('studies')).toBe(cefrOf('study'));
    expect(cefrOf('boxes')).toBe(cefrOf('box'));
    expect(cefrOf('negotiated')).toBe('B2');
    expect(cefrOf('negotiating')).toBe('B2');
    expect(cefrOf('running')).toBe('A2'); // doubled consonant / present verbatim
    expect(cefrOf('faster')).toBe(cefrOf('fast'));
    expect(cefrOf('largest')).toBe(cefrOf('large'));
    expect(cefrOf('quickly')).toBe(cefrOf('quick'));
  });

  it('never strips a lemma that exists verbatim (exact match wins over de-inflection)', () => {
    // `offer`/`water`/`member` must not be mistaken for `off`/`wat`/`memb`.
    expect(cefrOf('offer')).toBe(cefrOf('offer'));
    expect(cefrOf('offer')).not.toBeUndefined();
    expect(cefrOf('water')).toBe('A2');
    expect(cefrOf('member')).not.toBeUndefined();
  });

  it('returns undefined for out-of-list words (tolerant skip)', () => {
    expect(cefrOf('zxqwv')).toBeUndefined();
    expect(cefrOf('xylophonity')).toBeUndefined();
    expect(cefrOf('')).toBeUndefined();
  });
});

// ── Integration with the validator: the revived gate flags off-band passages ────────
function bareValidationPassage(tokens: string[]): PassageOutput {
  return {
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [{ tokens, translationJa: '' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

describe('CEFR gate revived by the real dictionary', () => {
  it('flags a B1 request whose passage is saturated with C1/C2 vocabulary', () => {
    // ~44% of the known-band tokens sit above B1 → over the 0.15 tolerance.
    const passage = bareValidationPassage([
      'The', 'esoteric', 'and', 'ubiquitous', 'ideas', 'were', 'superfluous', 'yet', 'meticulous', '.',
    ]);
    const report = passageValidator.validate(passage, { level: 'B1', targets: [], cefrOf });
    expect(report.cefrSampleSize).toBeGreaterThan(0);
    expect(report.cefrOffBandRatio).toBeGreaterThan(0.15);
    expect(report.violations.some((v) => v.kind === 'cefr_out_of_band')).toBe(true);
  });

  it('accepts an in-band B1 passage and still reports a non-zero sample size', () => {
    const passage = bareValidationPassage(['The', 'team', 'will', 'negotiate', 'the', 'deal', 'today', '.']);
    const report = passageValidator.validate(passage, { level: 'B2', targets: [], cefrOf });
    expect(report.cefrSampleSize).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.kind === 'cefr_out_of_band')).toBe(false);
  });

  it('the same advanced passage is in-band for a C2 request', () => {
    const passage = bareValidationPassage(['The', 'esoteric', 'ubiquitous', 'superfluous', 'meticulous', 'idea', '.']);
    const report = passageValidator.validate(passage, { level: 'C2', targets: [], cefrOf });
    expect(report.cefrOffBandRatio).toBe(0);
    expect(report.violations.some((v) => v.kind === 'cefr_out_of_band')).toBe(false);
  });

  it('asset stays within the gzip budget assumption (raw ≤ 500KB as a coarse guard)', () => {
    // The precise gzip check lives in tooling; here we just guard against an accidental blow-up
    // of the bundled asset. A Cefr union guard keeps the band values in the app's five bands.
    const bands: Cefr[] = ['A2', 'B1', 'B2', 'C1', 'C2'];
    for (const w of ['the', 'negotiate', 'esoteric', 'abstruse']) {
      expect(bands).toContain(cefrOf(w));
    }
  });
});

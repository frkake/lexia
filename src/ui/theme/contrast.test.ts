import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, meetsAA, AA_NORMAL_TEXT, AA_LARGE_TEXT } from './contrast';

describe('contrast utilities', () => {
  it('computes relative luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is case- and hash-insensitive', () => {
    expect(relativeLuminance('ffffff')).toBeCloseTo(relativeLuminance('#FFFFFF'), 10);
  });

  it('gives the maximal 21:1 ratio for black on white and is symmetric', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 2);
  });

  it('reports AA pass/fail against the documented thresholds', () => {
    expect(AA_NORMAL_TEXT).toBe(4.5);
    expect(AA_LARGE_TEXT).toBe(3);
    // A mid grey (#767676) is the canonical AA boundary on white (~4.54:1).
    expect(meetsAA('#767676', '#FFFFFF')).toBe(true);
    // A lighter grey fails normal text but clears the relaxed large-text bar.
    expect(meetsAA('#949494', '#FFFFFF')).toBe(false);
    expect(meetsAA('#949494', '#FFFFFF', true)).toBe(true);
  });
});

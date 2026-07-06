import { describe, it, expect } from 'vitest';
import { mergeWordIds, resolveTargetWordSelection } from './targetWordResolution';

describe('mergeWordIds()', () => {
  it('unions groups case-insensitively, keeping the first-seen spelling and order', () => {
    expect(mergeWordIds(['Deal', 'zest'], ['deal', 'candid'])).toEqual(['Deal', 'zest', 'candid']);
  });

  it('trims and drops blanks', () => {
    expect(mergeWordIds([' deal ', '', '  '], ['zest'])).toEqual(['deal', 'zest']);
  });
});

describe('resolveTargetWordSelection()', () => {
  it('keeps manual words first, then backfills with suggestions up to the plan total', () => {
    expect(resolveTargetWordSelection(['zest'], ['alpha', 'beta', 'gamma'], 3)).toEqual(['zest', 'alpha', 'beta']);
  });

  it('backfills from suggestions alone when there are no manual words', () => {
    expect(resolveTargetWordSelection([], ['alpha', 'beta'], 3)).toEqual(['alpha', 'beta']);
  });

  it('never truncates manual words even when they already exceed the plan total', () => {
    expect(resolveTargetWordSelection(['a', 'b', 'c', 'd'], ['x'], 2)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not duplicate a suggested word that the learner already added (case-insensitive)', () => {
    expect(resolveTargetWordSelection(['Deal'], ['deal', 'zest'], 3)).toEqual(['Deal', 'zest']);
  });

  it('returns the manual list unchanged when the plan is already met by manual words', () => {
    expect(resolveTargetWordSelection(['a', 'b'], ['x', 'y'], 2)).toEqual(['a', 'b']);
  });
});

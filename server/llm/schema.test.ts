import { describe, it, expect } from 'vitest';
import { buildAnnotationMessages } from './schema';
import type { PassageAnnotationRequest } from '../../src/types/domain';

describe('buildAnnotationMessages — REQUIRED COVERAGE from body marks', () => {
  it('lists every collocation and study word as required coverage, in canonical surface form', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [
        { tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '' },
        { tokens: ['It', 'does', "n't", 'matter', '.'], translationJa: '' },
      ],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev' }],
      targetSpans: [{ sentenceIndex: 1, tokenStart: 1, tokenEnd: 3, wordId: 'matter', surface: "doesn't", masteryDensity: 'review' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user.toUpperCase()).toContain('REQUIRED COVERAGE');
    expect(user).toContain('"leverage our reputation" (collocation)');
    // Study word rebuilt with canonical spacing (clitic): "doesn't", not "does n't".
    expect(user).toContain('"doesn\'t" (word)');
    expect(user).not.toContain('does n\'t');
  });

  it('does not separately require a study word that sits wholly inside a listed collocation', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [{ tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '' }],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'leverage', surface: 'leverage', masteryDensity: 'new' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user).toContain('"leverage our reputation" (collocation)');
    expect(user).not.toContain('"leverage" (word)');
  });

  it('omits the required-coverage section entirely when no spans are supplied (back-compat)', () => {
    const req: PassageAnnotationRequest = {
      level: 'B1',
      sentences: [{ tokens: ['Hello', '.'], translationJa: '' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user.toUpperCase()).not.toContain('REQUIRED COVERAGE');
  });
});

import { describe, it, expect } from 'vitest';
import { lengthSpec, WORDS_PER_PAGE, LENGTH_WORD_TOLERANCE, idiomQuotaFor, setPhraseQuotaFor } from './lengthSpec';

describe('idiomQuotaFor / setPhraseQuotaFor (B-1/B-2)', () => {
  it('floors both quotas at 2 for short passages', () => {
    expect(idiomQuotaFor(100)).toBe(2);
    expect(setPhraseQuotaFor(100)).toBe(2);
    expect(idiomQuotaFor(250)).toBe(2); // round(250/150)=round(1.67)=2
    expect(setPhraseQuotaFor(300)).toBe(2); // round(300/200)=round(1.5)=2
  });

  it('scales the idiom quota at ~1 per 150 words and the set-phrase quota at ~1 per 200', () => {
    expect(idiomQuotaFor(1000)).toBe(7); // round(1000/150)=7
    expect(setPhraseQuotaFor(1000)).toBe(5); // round(1000/200)=5
    expect(idiomQuotaFor(600)).toBe(4);
    expect(setPhraseQuotaFor(500)).toBe(3); // round(500/200)=round(2.5)=3
  });
});

describe('lengthSpec.wordRange', () => {
  it('returns content-type ranges with a 100-word step', () => {
    expect(lengthSpec.wordRange('article')).toEqual({ min: 100, max: 1500, step: 100 });
    expect(lengthSpec.wordRange('short_story')).toEqual({ min: 500, max: 3000, step: 100 });
    expect(lengthSpec.wordRange('long_story')).toEqual({ min: 800, max: 2500, step: 100 });
  });
});

describe('lengthSpec.pagesFor', () => {
  it('converts words to pages at ~275 words/page (rounded)', () => {
    expect(WORDS_PER_PAGE).toBe(275);
    expect(lengthSpec.pagesFor(275)).toBe(1);
    expect(lengthSpec.pagesFor(550)).toBe(2);
    expect(lengthSpec.pagesFor(400)).toBe(1); // 400/275 = 1.45 → 1
    expect(lengthSpec.pagesFor(500)).toBe(2); // 500/275 = 1.8 → 2
  });
});

describe('lengthSpec.tokenBudgetFor', () => {
  it('is monotonic non-decreasing in word count', () => {
    const budgets = [200, 400, 800, 1500].map((w) => lengthSpec.tokenBudgetFor(w));
    for (let i = 1; i < budgets.length; i += 1) {
      expect(budgets[i]!).toBeGreaterThanOrEqual(budgets[i - 1]!);
    }
  });

  it('gives a larger budget than the word count itself (room for JSON + translations)', () => {
    expect(lengthSpec.tokenBudgetFor(400)).toBeGreaterThan(400);
  });

  // Regression (validation_exhausted trap): a bilingual PassageOutput must actually FIT in the
  // budget. Each English word is its own quoted JSON array element (~2.7 output tokens) and every
  // sentence also carries a Japanese translationJa (~2 tokens/word) plus target/translation spans.
  // The old maxTokensForLength gave ~9 tokens/word (long=3600 for 400 words); a smaller budget
  // starves the model into truncating/under-producing below the non-salvageable length floor.
  it('provides at least the old systemʼs capacity for a 400-word passage (no regression)', () => {
    // Old maxTokensForLength for a 400-word ("long") passage was 3600 tokens.
    expect(lengthSpec.tokenBudgetFor(400)).toBeGreaterThanOrEqual(3600);
  });

  it('allots enough tokens to encode a bilingual passage (~8+ output tokens per word)', () => {
    for (const w of [200, 400, 800]) {
      expect(lengthSpec.tokenBudgetFor(w) / w).toBeGreaterThanOrEqual(8);
    }
  });

  it('stays within a provider output ceiling for the largest targets', () => {
    // gpt-4o caps output at 16384 tokens; the budget must not exceed a safe ceiling.
    expect(lengthSpec.tokenBudgetFor(3000)).toBeLessThanOrEqual(16000);
  });
});

describe('lengthSpec.newWordsFor', () => {
  it('scales woven-in new words with word count and ratio', () => {
    const few = lengthSpec.newWordsFor(200, 0.3);
    const many = lengthSpec.newWordsFor(800, 0.3);
    expect(many).toBeGreaterThan(few);
    expect(few).toBeGreaterThanOrEqual(1); // always weave at least one when ratio > 0
  });

  it('returns at least one new word even for a tiny passage with a positive ratio', () => {
    expect(lengthSpec.newWordsFor(100, 0.1)).toBeGreaterThanOrEqual(1);
  });
});

describe('lengthSpec.targetWordPlanFor', () => {
  const RATIOS = [0, 0.3, 1] as const;
  const TARGETS = [100, 400, 800] as const;

  it('splits the exact review/new counts at the boundary word targets (A-1-3)', () => {
    // total = min(12, max(1, round(wordTarget / 40)))
    expect(lengthSpec.targetWordPlanFor(100, 0.3)).toEqual({ total: 3, newSlots: 1, reviewSlots: 2 });
    expect(lengthSpec.targetWordPlanFor(400, 0.3)).toEqual({ total: 10, newSlots: 3, reviewSlots: 7 });
    expect(lengthSpec.targetWordPlanFor(800, 0.3)).toEqual({ total: 12, newSlots: 4, reviewSlots: 8 });
  });

  it('caps total at 12 for large targets and floors it at 1 for tiny targets', () => {
    expect(lengthSpec.targetWordPlanFor(800, 0.3).total).toBe(12); // round(20) clamped to 12
    expect(lengthSpec.targetWordPlanFor(2500, 1).total).toBe(12);
    expect(lengthSpec.targetWordPlanFor(10, 0.3).total).toBe(1); // round(0.25)=0 floored to 1
  });

  it('keeps total ≥ 1 and reviewSlots + newSlots === total for every boundary combination', () => {
    for (const wordTarget of TARGETS) {
      for (const ratio of RATIOS) {
        const plan = lengthSpec.targetWordPlanFor(wordTarget, ratio);
        expect(plan.total).toBeGreaterThanOrEqual(1);
        expect(plan.reviewSlots + plan.newSlots).toBe(plan.total);
        expect(plan.newSlots).toBeGreaterThanOrEqual(0);
        expect(plan.reviewSlots).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ratio 0 is review-only (newSlots 0) yet still weaves in at least one word', () => {
    for (const wordTarget of TARGETS) {
      const plan = lengthSpec.targetWordPlanFor(wordTarget, 0);
      expect(plan.newSlots).toBe(0);
      expect(plan.reviewSlots).toBe(plan.total);
      expect(plan.total).toBeGreaterThanOrEqual(1);
    }
  });

  it('ratio 1 is new-only (reviewSlots 0)', () => {
    for (const wordTarget of TARGETS) {
      const plan = lengthSpec.targetWordPlanFor(wordTarget, 1);
      expect(plan.reviewSlots).toBe(0);
      expect(plan.newSlots).toBe(plan.total);
    }
  });

  it('clamps out-of-range ratios into [0, 1]', () => {
    expect(lengthSpec.targetWordPlanFor(400, -0.5)).toEqual(lengthSpec.targetWordPlanFor(400, 0));
    expect(lengthSpec.targetWordPlanFor(400, 1.5)).toEqual(lengthSpec.targetWordPlanFor(400, 1));
  });
});

describe('lengthSpec.migrateLegacyLength', () => {
  it('maps the legacy 3-value length onto a seed word target', () => {
    expect(lengthSpec.migrateLegacyLength('short')).toBe(200);
    expect(lengthSpec.migrateLegacyLength('medium')).toBe(400);
    expect(lengthSpec.migrateLegacyLength('long')).toBe(800);
  });

  it('always yields a multiple of 100', () => {
    for (const l of ['short', 'medium', 'long'] as const) {
      expect(lengthSpec.migrateLegacyLength(l) % 100).toBe(0);
    }
  });
});

describe('LENGTH_WORD_TOLERANCE', () => {
  it('is restored to 0.25 (B-5 第2弾) now that generation reaches the requested length', () => {
    // Band is 0.75×–1.25× the target: a right-sized token budget + chunked long-form generation
    // mean a large target no longer truncates into a stub, so the loose 0.6 stopgap is retired.
    expect(LENGTH_WORD_TOLERANCE).toBe(0.25);
  });
});

// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { resolveReviewMaterial, splitAround, renderPassageCorpus } from './reviewMaterial';
import type { PassageRecord } from '../../types/ports';
import type { UserId, WordData } from '../../types/domain';

const USER = 'u1' as UserId;

function word(over: Partial<WordData['core']> = {}): WordData {
  return {
    wordId: 'mitigate',
    headword: 'mitigate',
    ipa: '/ˈmɪtɪɡeɪt/',
    pos: ['verb'],
    register: 'formal',
    connotation: 'neutral',
    frequency: 3,
    core: {
      meaningsJa: ['和らげる'],
      examples: [
        { en: 'They tried to mitigate the damage after the storm.', ja: '嵐の後、被害を和らげようとした。' },
        { en: 'New rules mitigate the risk of fraud.', ja: '新しい規則は詐欺のリスクを軽減する。' },
      ],
      collocations: [{ id: 'mitigate-the-risk', pattern: 'mitigate ＜リスク・被害＞', type: 'V+N', slotExamples: ['risk', 'damage'], glossJa: 'リスクを和らげる', l1Contrast: false }],
      synonymNuances: ['alleviate'],
      ...over,
    },
  };
}

function passageRecord(sentences: { en: string }[]): PassageRecord {
  return {
    passageId: 'p1',
    userId: USER,
    createdAt: 0,
    passage: {
      meta: { title: 't', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 10 },
      sentences: sentences.map((s) => ({ tokens: s.en.split(' '), translationJa: '' })),
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
    },
  } as unknown as PassageRecord;
}

describe('splitAround()', () => {
  it('splits case-insensitively on a whole word', () => {
    expect(splitAround('We must Mitigate risk now.', 'mitigate')).toEqual({
      before: 'We must ',
      target: 'Mitigate',
      after: ' risk now.',
    });
  });
  it('returns null when the target is absent', () => {
    expect(splitAround('nothing here', 'mitigate')).toBeNull();
  });
});

describe('resolveReviewMaterial() priority chain', () => {
  it('tier 1: prefers a sentence from a past passage', async () => {
    const corpus = renderPassageCorpus([passageRecord([{ en: 'The plan will mitigate future losses .' }])]);
    const m = await resolveReviewMaterial({ corpus }, word(), 'mitigate', 'B1', 0);
    expect(m.source).toBe('passage');
    expect(m.context.target.toLowerCase()).toBe('mitigate');
    expect(`${m.context.before}${m.context.target}${m.context.after}`).toContain('future losses');
  });

  it('tier 2: rotates the cached examples when no passage matches', async () => {
    const m0 = await resolveReviewMaterial({ corpus: [] }, word(), 'mitigate', 'B1', 0);
    const m1 = await resolveReviewMaterial({ corpus: [] }, word(), 'mitigate', 'B1', 1);
    expect(m0.source).toBe('example');
    expect(m1.source).toBe('example');
    expect(m0.context.after).not.toBe(m1.context.after); // different example picked
  });

  it('tier 3: falls to the LLM proxy when there is no cached example', async () => {
    const reviewSentence = vi.fn(async () => 'A fresh sentence to mitigate the effect.');
    const m = await resolveReviewMaterial(
      { corpus: [], reviewSentence },
      word({ examples: [] }),
      'mitigate',
      'B1',
      0,
    );
    expect(reviewSentence).toHaveBeenCalledTimes(1);
    expect(m.source).toBe('llm');
  });

  it('tier 4: bare headword when the proxy fails (no dummy sentence)', async () => {
    const reviewSentence = vi.fn(async () => {
      throw new Error('offline');
    });
    const m = await resolveReviewMaterial(
      { corpus: [], reviewSentence },
      word({ examples: [] }),
      'mitigate',
      'B1',
      0,
    );
    expect(m.source).toBe('headword');
    expect(m.context).toEqual({ before: '', target: 'mitigate', after: '' });
  });

  it('tier 4: bare headword when WordData is missing and no corpus/LLM', async () => {
    const m = await resolveReviewMaterial({ corpus: [] }, undefined, 'concede', 'B1', 0);
    expect(m.source).toBe('headword');
    expect(m.context.target).toBe('concede');
  });
});

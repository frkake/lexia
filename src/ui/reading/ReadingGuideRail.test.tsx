// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ReadingGuideRail, buildReadingGuide, placeGuideItems } from './ReadingGuideRail';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore } from '../../state/stores/readingUiStore';
import type { IndexedPassage, PassageOutput } from '../../types/domain';
import type { StudyWord } from './StudyWordsList';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 18 },
    sentences: [
      { tokens: ['We', 'closed', 'the', 'deal', 'today', '.'], translationJa: '今日、取引を成立させた。' },
      { tokens: ['They', 'met', 'again', 'and', 'talked', '.'], translationJa: '彼らは再び会って話した。' },
      { tokens: ['The', 'deal', 'felt', 'fair', '.'], translationJa: 'その取引は公平に感じられた。' },
    ],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
      { sentenceIndex: 2, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
    ],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 },
        category: 'phrase',
        anchorText: 'closed the deal',
        explanationJa: '取引を成立させる定型表現。',
      },
      {
        index: 2,
        span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 3 },
        category: 'sentence_structure',
        anchorText: 'They met again',
        explanationJa: '短い文で場面を進める。',
      },
      {
        index: 3,
        span: { sentenceIndex: 2, tokenStart: 1, tokenEnd: 2 },
        category: 'grammar_pattern',
        anchorText: 'deal',
        explanationJa: '文法上の主語。',
      },
      {
        index: 4,
        span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 },
        category: 'connotation',
        wordId: 'deal',
        anchorText: 'deal',
        explanationJa: '取引という語の商談らしい響き。',
      },
    ],
  };
  return tokenizer.index('p', source);
}

const words: StudyWord[] = [
  {
    wordId: 'deal',
    surface: 'deal',
    stage: 'Learning',
    meaningJa: '取引',
    collocation: 'close a deal',
    frequency: 4,
  },
];

function expectTextOrder(node: HTMLElement, first: string, second: string): void {
  const text = node.textContent ?? '';
  expect(text.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(second)).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(first)).toBeLessThan(text.indexOf(second));
}

beforeEach(() => {
  readingUiStore.getState().reset();
});

describe('buildReadingGuide', () => {
  it('uses the first target occurrence and keeps broader non-study notices standalone', () => {
    const guide = buildReadingGuide(makePassage(), words);

    expect(guide.items.map((item) => item.id)).toEqual(['notice:1', 'word:deal', 'notice:2', 'notice:3']);
    const study = guide.items[1]!;
    expect(study.kind).toBe('study');
    if (study.kind === 'study') {
      expect(study.span.sentenceIndex).toBe(0);
      expect(study.notices.map((notice) => notice.cue.index)).toEqual([4]);
      expect(study.notices[0]!.expression).toBe('deal');
    }
    expect(guide.cueTargetIdByIndex[1]).toBe('guide-item-notice:1');
    expect(guide.cueTargetIdByIndex[4]).toBe('guide-item-word:deal');
    expect(guide.cueTargetIdByIndex[2]).toBe('guide-item-notice:2');
    expect(guide.guideNumberByCueIndex).toMatchObject({ 1: 1, 4: 2, 2: 3, 3: 4 });
    expect(guide.guideNumberByWordKey.deal).toBe(2);
    expect(guide.absorbedCueIndexByIndex).toEqual({ 4: true });
  });

  it('keeps non-lexical overlapping notices standalone unless they explicitly point to the word', () => {
    const guide = buildReadingGuide(makePassage(), words);
    const grammar = guide.items.find((item) => item.id === 'notice:3');
    expect(grammar?.kind).toBe('notice');
  });
});

describe('placeGuideItems', () => {
  it('places guide items at their anchors and pushes near items downward', () => {
    const guide = buildReadingGuide(makePassage(), words);
    const placed = placeGuideItems(guide.items, [
      { itemId: 'notice:1', top: 20 },
      { itemId: 'word:deal', top: 30 },
      { itemId: 'notice:2', top: 40 },
      { itemId: 'notice:3', top: 300 },
    ], {
      'notice:1': 80,
      'word:deal': 120,
      'notice:2': 80,
      'notice:3': 80,
    });

    expect(placed).toEqual([
      { itemId: 'notice:1', top: 20 },
      { itemId: 'word:deal', top: 112 },
      { itemId: 'notice:2', top: 244 },
      { itemId: 'notice:3', top: 336 },
    ]);
  });
});

describe('<ReadingGuideRail/>', () => {
  it('renders one unified learning guide with broader notices still visible as their own cards', () => {
    const { getByText, getByTestId, queryByText } = render(<ReadingGuideRail passage={makePassage()} words={words} />);

    expect(getByText('学習ガイド')).toBeTruthy();
    expect(queryByText('この文章で気づきたいこと')).toBeNull();
    const study = getByTestId('guide-item-word:deal');
    expect(within(study).getByText('2')).toBeTruthy();
    expect(within(study).getByText('取引')).toBeTruthy();
    expect(within(study).getByText('学習語句')).toBeTruthy();
    expect(within(study).queryByTestId('mastery-dot')).toBeNull();
    expectTextOrder(study, 'deal', '学習語句');
    expect(within(getByTestId('guide-item-notice:1')).getByText('1')).toBeTruthy();
    expect(getByTestId('guide-item-notice:1').textContent).toContain('取引を成立させる定型表現。');
    expect(getByTestId('guide-absorbed-notice-4').textContent).toContain('取引という語の商談らしい響き。');
    expectTextOrder(getByTestId('guide-item-notice:1'), 'closed the deal', 'フレーズ');
    expectTextOrder(getByTestId('guide-absorbed-notice-4'), 'deal', 'コノテーション');
  });

  it('shows study words by base form even when the passage uses a plural surface', () => {
    const source: PassageOutput = {
      meta: { title: 't', intent: 'daily', level: 'A2', newCount: 1, reviewCount: 0, approxWords: 4 },
      sentences: [{ tokens: ['Many', 'dogs', 'wait', '.'], translationJa: '多くの犬が待っている。' }],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'dog', surface: 'dogs', masteryDensity: 'new' },
      ],
      collocationSpans: [],
      noticeCues: [],
    };
    const passage = tokenizer.index('plural-p', source);
    const { getByTestId } = render(<ReadingGuideRail passage={passage} words={[{ wordId: 'dog', surface: 'dogs' }]} />);
    const study = getByTestId('guide-item-word:dog');

    expect(within(study).getByText('dog')).toBeTruthy();
    expect(within(study).queryByText('dogs')).toBeNull();
  });

  it('opens word details from a study-word card and records unknown from a standalone notice', () => {
    const onSelectWord = vi.fn();
    const onMarkUnknown = vi.fn();
    const { getByTestId, getByLabelText } = render(
      <ReadingGuideRail passage={makePassage()} words={words} onSelectWord={onSelectWord} onMarkUnknown={onMarkUnknown} />,
    );

    fireEvent.click(getByTestId('guide-item-word:deal'));
    expect(onSelectWord).toHaveBeenCalledWith('deal');

    fireEvent.click(getByLabelText('They met again を知らなかったとして記録'));
    expect(onMarkUnknown).toHaveBeenCalledWith('They met again');
  });

  it('uses absolute positioning when anchors are supplied', () => {
    const { getByTestId } = render(
      <ReadingGuideRail
        passage={makePassage()}
        words={words}
        anchors={[{ itemId: 'notice:1', top: 20 }, { itemId: 'word:deal', top: 30 }, { itemId: 'notice:2', top: 40 }]}
      />,
    );

    expect(getByTestId('guide-item-notice:1').style.position).toBe('absolute');
    expect(getByTestId('guide-item-word:deal').style.top).not.toBe('30px');
    expect(parseFloat(getByTestId('guide-item-notice:2').style.top)).toBeGreaterThan(40);
  });
});

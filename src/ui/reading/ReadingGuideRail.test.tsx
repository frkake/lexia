// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within, act } from '@testing-library/react';
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

  it('subtracts the rail origin so frame-relative anchors land in the rail body coordinate space (D-1)', () => {
    const guide = buildReadingGuide(makePassage(), words);
    // Anchors are frame-relative (measured against `.reading-layout`); the rail body starts 500px down.
    const anchors = [
      { itemId: 'notice:1', top: 520 },
      { itemId: 'word:deal', top: 560 },
      { itemId: 'notice:2', top: 900 },
      { itemId: 'notice:3', top: 1200 },
    ];
    const heights = { 'notice:1': 44, 'word:deal': 44, 'notice:2': 44, 'notice:3': 44 };
    const placed = placeGuideItems(guide.items, anchors, heights, 500);

    expect(placed).toEqual([
      { itemId: 'notice:1', top: 20 }, // 520 - 500
      { itemId: 'word:deal', top: 76 }, // max(560-500=60, 20+44+12=76)
      { itemId: 'notice:2', top: 400 }, // max(900-500=400, 76+44+12=132)
      { itemId: 'notice:3', top: 700 }, // max(1200-500=700, 400+44+12=456)
    ]);
  });
});

describe('<ReadingGuideRail/>', () => {
  it('renders one unified learning guide with broader notices still visible as their own cards', () => {
    const { getByText, getByTestId, queryByText } = render(<ReadingGuideRail passage={makePassage()} words={words} />);

    expect(getByText('学習ガイド')).toBeTruthy();
    expect(queryByText('この文章で気づきたいこと')).toBeNull();
    const study = getByTestId('guide-item-word:deal');
    // D-1: the collapsed summary shows the guide number, base-form label and a one-line gloss.
    expect(within(study).getByText('2')).toBeTruthy();
    expect(within(study).getByText('取引')).toBeTruthy();
    expect(within(study).queryByTestId('mastery-dot')).toBeNull();
    // Expanding reveals the 学習語句 badge and the absorbed-notice detail.
    fireEvent.click(study);
    expect(within(study).getByText('学習語句')).toBeTruthy();
    expectTextOrder(study, 'deal', '学習語句');
    expect(getByTestId('guide-absorbed-notice-4').textContent).toContain('取引という語の商談らしい響き。');
    expectTextOrder(getByTestId('guide-absorbed-notice-4'), 'deal', 'コノテーション');

    const notice1 = getByTestId('guide-item-notice:1');
    expect(within(notice1).getByText('1')).toBeTruthy();
    expectTextOrder(notice1, 'closed the deal', 'フレーズ');
    // The explanation lives in the expand-on-click detail.
    fireEvent.click(notice1);
    expect(notice1.textContent).toContain('取引を成立させる定型表現。');
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

  it('renders cards collapsed and expands the detail on click (D-1 compact cards)', () => {
    const { getByTestId } = render(<ReadingGuideRail passage={makePassage()} words={words} />);
    const notice = getByTestId('guide-item-notice:1');
    // Collapsed: the explanation is not rendered until the card is opened.
    expect(notice.getAttribute('aria-expanded')).toBe('false');
    expect(notice.textContent).not.toContain('取引を成立させる定型表現。');
    fireEvent.click(notice);
    expect(notice.getAttribute('aria-expanded')).toBe('true');
    expect(notice.textContent).toContain('取引を成立させる定型表現。');
    // Clicking again collapses it.
    fireEvent.click(notice);
    expect(notice.getAttribute('aria-expanded')).toBe('false');
  });

  it('auto-expands the guide card whose cue gets pinned so the spotlight reveals its detail (D-1)', () => {
    const { getByTestId } = render(<ReadingGuideRail passage={makePassage()} words={words} />);
    const notice = getByTestId('guide-item-notice:2');
    expect(notice.getAttribute('aria-expanded')).toBe('false');
    // Pinning cue 2 (e.g. clicking its in-text badge) opens the matching card in place.
    act(() => readingUiStore.getState().setPinned(2));
    expect(notice.getAttribute('aria-expanded')).toBe('true');
    expect(notice.textContent).toContain('短い文で場面を進める。');
  });

  it('opens word details from the expanded study card action and records unknown from a notice (D-1)', () => {
    const onSelectWord = vi.fn();
    const onMarkUnknown = vi.fn();
    const { getByTestId } = render(
      <ReadingGuideRail passage={makePassage()} words={words} onSelectWord={onSelectWord} onMarkUnknown={onMarkUnknown} />,
    );

    // The card body click expands; the word detail moves to the "解説を開く" action inside the detail.
    fireEvent.click(getByTestId('guide-item-word:deal'));
    expect(onSelectWord).not.toHaveBeenCalled();
    fireEvent.click(getByTestId('guide-open-detail-deal'));
    expect(onSelectWord).toHaveBeenCalledWith('deal');

    // Standalone notice: expand, then record unknown from its detail action.
    fireEvent.click(getByTestId('guide-item-notice:2'));
    fireEvent.click(getByTestId('guide-notice-mark-unknown-2'));
    expect(onMarkUnknown).toHaveBeenCalledWith('They met again');
  });

  it('toggles expand from the focusable summary disclosure and stops inner buttons at the button (D-1/D-8)', () => {
    const onSelectWord = vi.fn();
    const onMarkUnknown = vi.fn();
    const { getByTestId } = render(
      <ReadingGuideRail passage={makePassage()} words={words} onSelectWord={onSelectWord} onMarkUnknown={onMarkUnknown} />,
    );

    const card = getByTestId('guide-item-word:deal');
    const toggle = getByTestId('guide-toggle-word:deal');
    // The summary row is a real, keyboard-operable <button> (no more role="button" on the card).
    expect(toggle.tagName).toBe('BUTTON');
    fireEvent.click(toggle); // activates the disclosure (revealing the inner action buttons)
    expect(card.getAttribute('aria-expanded')).toBe('true');

    // Clicking the inner "知らなかった" button records unknown and stops at the button — it must NOT
    // bubble to the card and collapse it again, nor open the word detail.
    fireEvent.click(getByTestId('guide-mark-unknown-deal'));
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(onMarkUnknown).toHaveBeenCalledWith('deal');
    expect(onSelectWord).not.toHaveBeenCalled();
  });

  it('nests no interactive control inside another in its cards (D-8 nested-interactive)', () => {
    const { getByTestId, container } = render(
      <ReadingGuideRail
        passage={makePassage()}
        words={words}
        onSelectWord={vi.fn()}
        onPlayWord={vi.fn()}
        onMarkUnknown={vi.fn()}
      />,
    );
    // Expand a study card and a standalone notice so every inner action button is in the DOM.
    fireEvent.click(getByTestId('guide-toggle-word:deal'));
    fireEvent.click(getByTestId('guide-toggle-notice:1'));

    const interactiveSelector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]';
    const interactives = Array.from(container.querySelectorAll<HTMLElement>(interactiveSelector));
    expect(interactives.length).toBeGreaterThan(0);
    // WAI-ARIA nested-interactive: no interactive control may contain another interactive control.
    for (const el of interactives) expect(el.querySelector(interactiveSelector)).toBeNull();
  });

  it('gives every guide card a pointer cursor since cards expand on click (D-1)', () => {
    const { getByTestId } = render(<ReadingGuideRail passage={makePassage()} words={words} />);
    // Every card is clickable (it expands), so all signal clickability — no dead, un-hinted cards.
    expect(getByTestId('guide-item-word:deal').style.cursor).toBe('pointer');
    expect(getByTestId('guide-item-notice:1').style.cursor).toBe('pointer');
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

// ── C-1 annotation side: the cue「詳しく」detail toggle (origin / parse explanation) ──────
function makeDetailPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 't', intent: 'business', level: 'C1', newCount: 0, reviewCount: 0, approxWords: 6 },
    sentences: [{ tokens: ['They', 'broke', 'the', 'ice', 'quickly', '.'], translationJa: 'すぐに場を和ませた。' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 },
        category: 'idiom',
        anchorText: 'broke the ice',
        explanationJa: '場の緊張をほぐす固定表現。',
        detailJa: '船が氷を割って航路を開くイメージ → 固まった空気を最初に壊す → 「緊張をほぐす」の意味に。',
      },
    ],
  };
  return tokenizer.index('p-detail', source);
}

describe('ReadingGuideRail — C-1 detailJa toggle', () => {
  it('reveals detailJa behind a 詳しく toggle inside an expanded cue card', () => {
    const { getByTestId, queryByTestId } = render(<ReadingGuideRail passage={makeDetailPassage()} words={[]} />);
    const notice = getByTestId('guide-item-notice:1');
    // The detail toggle only exists once the card is expanded.
    expect(queryByTestId('guide-notice-detail-toggle-1')).toBeNull();
    fireEvent.click(notice);
    // Compact explanationJa is shown; detailJa is hidden until the toggle is opened.
    expect(notice.textContent).toContain('場の緊張をほぐす固定表現。');
    expect(queryByTestId('guide-notice-detail-1')).toBeNull();
    fireEvent.click(getByTestId('guide-notice-detail-toggle-1'));
    expect(getByTestId('guide-notice-detail-1').textContent).toContain('氷を割って');
  });

  it('auto-opens detailJa when the cue is pinned (spotlight)', () => {
    const { getByTestId } = render(<ReadingGuideRail passage={makeDetailPassage()} words={[]} />);
    act(() => readingUiStore.getState().setPinned(1));
    expect(getByTestId('guide-item-notice:1').getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('guide-notice-detail-1').textContent).toContain('氷を割って');
  });

  it('renders no 詳しく toggle for a cue without detailJa (back-compat)', () => {
    const { getByTestId, queryByTestId } = render(<ReadingGuideRail passage={makePassage()} words={words} />);
    fireEvent.click(getByTestId('guide-item-notice:1'));
    expect(queryByTestId('guide-notice-detail-toggle-1')).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NoticeRail, placeRailItems } from './NoticeRail';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore } from '../../state/stores/readingUiStore';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 't', intent: 'business', level: 'B2', newCount: 1, reviewCount: 1, approxWords: 8 },
    sentences: [
      { tokens: ['The', 'board', 'was', 'restless', '.'], translationJa: '' },
      { tokens: ['We', 'leverage', 'our', 'reputation', '.'], translationJa: '' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 },
        category: 'connotation',
        wordId: 'restless',
        sourceAttribute: 'connotation',
        anchorText: 'restless',
        explanationJa: '不安・苛立ちを含む否定的な響き。',
      },
      {
        index: 2,
        span: { sentenceIndex: 1, tokenStart: 1, tokenEnd: 4 },
        category: 'collocation',
        wordId: 'leverage',
        sourceAttribute: 'collocations',
        anchorText: 'leverage our reputation',
        explanationJa: '活かせる資産が来る。',
      },
    ],
  };
  return tokenizer.index('p1', source);
}

describe('<NoticeRail/>', () => {
  it('titles the notice section', () => {
    const { getByText } = render(<NoticeRail passage={makePassage()} />);
    expect(getByText('この文章で気づきたいこと')).toBeTruthy();
  });

  it('lists each cue with its number, category chip, expression and explanation (6.1/6.2)', () => {
    const { getByText, getByTestId } = render(<NoticeRail passage={makePassage()} />);
    expect(getByTestId('notice-item-1').textContent).toContain('コノテーション');
    expect(getByText('restless')).toBeTruthy();
    expect(getByText('不安・苛立ちを含む否定的な響き。')).toBeTruthy();
    // expression spanning multiple tokens is rebuilt from the passage
    expect(getByText('leverage our reputation')).toBeTruthy();
    expect(getByTestId('notice-item-2').textContent).toContain('コロケーション');
  });

  it('renders the expression with canonical spacing (clitics/punctuation) — matching the body marker', () => {
    const source: PassageOutput = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
      // "doesn't" tokenizes to ["does","n't"]; a naive join would show "does n't".
      sentences: [{ tokens: ['It', 'does', "n't", 'matter', '.'], translationJa: '' }],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [
        {
          index: 1,
          span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 3 },
          category: 'grammar_pattern',
          wordId: 'matter',
          sourceAttribute: 'more.grammarPatterns',
          anchorText: "doesn't",
          explanationJa: '否定の縮約。',
        },
      ],
    };
    const { getByText, queryByText } = render(<NoticeRail passage={tokenizer.index('p', source)} />);
    expect(getByText("doesn't")).toBeTruthy();
    expect(queryByText('does n\'t')).toBeNull();
  });

  it('marks a notice expression unknown directly, including non-word cues', () => {
    readingUiStore.getState().reset();
    const onMarkUnknown = vi.fn();
    const source: PassageOutput = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 6 },
      sentences: [{ tokens: ['They', 'bit', 'the', 'bullet', 'today', '.'], translationJa: '' }],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [
        {
          index: 1,
          span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 },
          category: 'idiom',
          anchorText: 'bit the bullet',
          explanationJa: '単語単体ではなく慣用表現として気づく。',
        },
      ],
    };
    const { getByLabelText } = render(
      <NoticeRail passage={tokenizer.index('idiom-p', source)} onMarkUnknown={onMarkUnknown} />,
    );

    fireEvent.click(getByLabelText('bit the bullet を知らなかったとして記録'));

    expect(onMarkUnknown).toHaveBeenCalledWith('bit the bullet');
    expect(readingUiStore.getState().pinnedCueIndex).toBeNull();
  });

  it('uses cue.wordId for unknown marking when the notice is grounded to a target word', () => {
    const onMarkUnknown = vi.fn();
    const { getByLabelText } = render(<NoticeRail passage={makePassage()} onMarkUnknown={onMarkUnknown} />);

    fireEvent.click(getByLabelText('leverage our reputation を知らなかったとして記録'));

    expect(onMarkUnknown).toHaveBeenCalledWith('leverage');
  });
});

describe('<NoticeRail/> Spotlight Link (item ↔ span)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('links each item to its in-text badge for AT', () => {
    const { getByTestId } = render(<NoticeRail passage={makePassage()} />);
    const item = getByTestId('notice-item-1');
    expect(item.getAttribute('id')).toBe('notice-item-1');
    expect(item.getAttribute('aria-controls')).toBe('notice-badge-1');
  });

  it('previews a cue on item hover and clears it on leave', () => {
    const { getByTestId } = render(<NoticeRail passage={makePassage()} />);
    const item = getByTestId('notice-item-2');
    fireEvent.mouseEnter(item);
    expect(readingUiStore.getState().hoverCueIndex).toBe(2);
    fireEvent.mouseLeave(item);
    expect(readingUiStore.getState().hoverCueIndex).toBeNull();
  });

  it('pins a cue when its item is clicked (and still jumps to the badge)', () => {
    const { getByTestId } = render(<NoticeRail passage={makePassage()} />);
    fireEvent.click(getByTestId('notice-item-1'));
    expect(readingUiStore.getState().pinnedCueIndex).toBe(1);
  });

  it('marks the active item with aria-current when its cue is lit', () => {
    readingUiStore.getState().setPinned(1);
    const { getByTestId } = render(<NoticeRail passage={makePassage()} />);
    expect(getByTestId('notice-item-1').getAttribute('aria-current')).toBe('true');
    expect(getByTestId('notice-item-2').getAttribute('aria-current')).toBeNull();
  });
});

describe('placeRailItems (line-alignment collision avoidance, 2.1/2.3)', () => {
  it('places each item at its anchor line when they do not collide', () => {
    const placed = placeRailItems(
      [
        { cueIndex: 1, top: 40 },
        { cueIndex: 2, top: 200 },
      ],
      60, // item height
    );
    expect(placed).toEqual([
      { cueIndex: 1, top: 40 },
      { cueIndex: 2, top: 200 },
    ]);
  });

  it('stacks near items downward so they never overlap, preserving order (2.3)', () => {
    const placed = placeRailItems(
      [
        { cueIndex: 1, top: 40 },
        { cueIndex: 2, top: 55 }, // only 15px below #1 → must be pushed to 40+60
        { cueIndex: 3, top: 60 }, // collides with the pushed #2 → pushed again
      ],
      60,
    );
    expect(placed.map((p) => p.cueIndex)).toEqual([1, 2, 3]);
    expect(placed[0]!.top).toBe(40);
    expect(placed[1]!.top).toBe(100); // 40 + 60
    expect(placed[2]!.top).toBe(160); // 100 + 60
  });

  it('sorts anchors by their appearance line before stacking', () => {
    const placed = placeRailItems(
      [
        { cueIndex: 3, top: 300 },
        { cueIndex: 1, top: 20 },
        { cueIndex: 2, top: 25 },
      ],
      50,
    );
    expect(placed.map((p) => p.cueIndex)).toEqual([1, 2, 3]);
    expect(placed.map((p) => p.top)).toEqual([20, 70, 300]);
  });
});

describe('<NoticeRail/> line-aligned mode (anchors provided, 2.1/2.4)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('absolutely positions each item at its anchor top when anchors are supplied', () => {
    const { getByTestId } = render(
      <NoticeRail passage={makePassage()} anchors={[{ cueIndex: 1, top: 40 }, { cueIndex: 2, top: 300 }]} />,
    );
    const item1 = getByTestId('notice-item-1');
    expect(item1.style.position).toBe('absolute');
    expect(item1.style.top).toBe('40px');
    expect(getByTestId('notice-item-2').style.top).toBe('300px');
  });

  it('keeps the badge↔item number correspondence after alignment (2.4)', () => {
    const { getByTestId } = render(
      <NoticeRail passage={makePassage()} anchors={[{ cueIndex: 1, top: 40 }, { cueIndex: 2, top: 300 }]} />,
    );
    // item id encodes the same cue number the in-text badge uses.
    expect(getByTestId('notice-item-1').getAttribute('id')).toBe('notice-item-1');
    expect(getByTestId('notice-item-1').getAttribute('aria-controls')).toBe('notice-badge-1');
    expect(getByTestId('notice-item-1').textContent).toContain('restless');
  });

  it('falls back to flat flow layout when no anchors are supplied', () => {
    const { getByTestId } = render(<NoticeRail passage={makePassage()} />);
    // No absolute positioning in the fallback (narrow / measurement-off).
    expect(getByTestId('notice-item-1').style.position).not.toBe('absolute');
  });
});

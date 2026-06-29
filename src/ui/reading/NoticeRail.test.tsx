// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NoticeRail } from './NoticeRail';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore } from '../../state/stores/readingUiStore';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 't', theme: 'negotiation', level: 'B2', newCount: 1, reviewCount: 1, approxWords: 8 },
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
      meta: { title: 't', theme: 'x', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
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

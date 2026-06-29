// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PassageRenderer } from './PassageRenderer';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'The Restless Boardroom', theme: 'negotiation', level: 'B2', newCount: 1, reviewCount: 2, approxWords: 12 },
    sentences: [
      // s0: "The board was growing restless ." → target "restless" + notice #1
      { tokens: ['The', 'board', 'was', 'growing', 'restless', '.'], translationJa: '取締役会は苛立っていた。' },
      // s1: "We can leverage our reputation ." → collocation over "leverage our reputation", target "leverage"
      { tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '評判を活かせる。' },
    ],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 4, tokenEnd: 5, wordId: 'restless', surface: 'restless', masteryDensity: 'review' },
      { sentenceIndex: 1, tokenStart: 2, tokenEnd: 3, wordId: 'leverage', surface: 'leverage', masteryDensity: 'new' },
    ],
    collocationSpans: [{ sentenceIndex: 1, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev-rep' }],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 4, tokenEnd: 5 },
        category: 'connotation',
        wordId: 'restless',
        sourceAttribute: 'connotation',
        anchorText: 'restless',
        explanationJa: '不安・苛立ちを含む否定的な響き。',
      },
    ],
  };
  return tokenizer.index('p1', source);
}

describe('<PassageRenderer/>', () => {
  it('renders the passage prose including non-annotated words', () => {
    const { getByText } = render(<PassageRenderer passage={makePassage()} />);
    expect(getByText('board')).toBeTruthy();
    expect(getByText('growing')).toBeTruthy();
  });

  it('annotates a target word with its mastery-density encoding', () => {
    const { getByText } = render(<PassageRenderer passage={makePassage()} />);
    const restless = getByText('restless');
    expect(restless.getAttribute('data-kind')).toBe('review');
  });

  it('opens word detail when a target word is selected', () => {
    const onSelectWord = vi.fn();
    const { getByText } = render(<PassageRenderer passage={makePassage()} onSelectWord={onSelectWord} />);
    fireEvent.click(getByText('restless'));
    expect(onSelectWord).toHaveBeenCalledWith('restless');
  });

  it('wraps a collocation in its own chip with the target nested inside', () => {
    const { container, getByText } = render(<PassageRenderer passage={makePassage()} />);
    expect(container.querySelector('[data-kind="collocation"]')).not.toBeNull();
    expect(getByText('leverage').getAttribute('data-kind')).toBe('new');
  });

  it('places a numbered notice badge for each cue', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} />);
    expect(getByTestId('notice-badge-1').textContent).toBe('1');
  });

  it('still renders a notice badge whose span ends inside a collocation chip', () => {
    // Cue #2 points at just "leverage" (tokens [2,3)), which sits inside the collocation
    // chip "leverage our reputation" (tokens [2,5)). The badge must not be swallowed by the
    // chip — otherwise the in-text marker disappears while NoticeRail still lists the cue.
    const source: PassageOutput = {
      meta: { title: 'T', theme: 'negotiation', level: 'B2', newCount: 1, reviewCount: 0, approxWords: 6 },
      sentences: [{ tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '評判を活かせる。' }],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'leverage', surface: 'leverage', masteryDensity: 'new' },
      ],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev-rep' }],
      noticeCues: [
        {
          index: 2,
          span: { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3 },
          category: 'connotation',
          wordId: 'leverage',
          sourceAttribute: 'connotation',
          anchorText: 'leverage',
          explanationJa: '中立的な響き。',
        },
      ],
    };
    const { getByTestId } = render(<PassageRenderer passage={tokenizer.index('p2', source)} />);
    expect(getByTestId('notice-badge-2').textContent).toBe('2');
  });

  it('applies the font scale to the prose container', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} fontScale={1.5} />);
    // base prose size is 19px → scaled to 28.5px
    expect(getByTestId('passage-prose').style.fontSize).toBe('28.5px');
  });
});

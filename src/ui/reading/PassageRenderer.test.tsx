// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PassageRenderer } from './PassageRenderer';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore } from '../../state/stores/readingUiStore';
import { cueHighlight } from '../theme/tokens';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

/** A sentence whose notice cue spans three PLAIN (non-target, non-collocation) tokens. */
function makeMultiTokenCuePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', theme: 'negotiation', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 5 },
    sentences: [{ tokens: ['We', 'leverage', 'our', 'reputation', '.'], translationJa: '評判を活かす。' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 2,
        span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 },
        category: 'collocation',
        anchorText: 'leverage our reputation',
        explanationJa: '活かせる資産が来る。',
      },
    ],
  };
  return tokenizer.index('p-multi', source);
}

/** A notice cue ("leverage", [2,3)) sitting INSIDE a collocation chip ("leverage our reputation"). */
function makeCueInsideCollocationPassage(): IndexedPassage {
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
        category: 'collocation',
        anchorText: 'leverage',
        explanationJa: '活かせる資産が来る。',
      },
    ],
  };
  return tokenizer.index('p-inside', source);
}

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

describe('<PassageRenderer/> Spotlight Link (cue ↔ span)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('tags the cue span end-to-end with data-cue-index, not just the badge', () => {
    const { container } = render(<PassageRenderer passage={makeMultiTokenCuePassage()} />);
    const segs = Array.from(container.querySelectorAll('[data-cue-index~="2"]'));
    expect(segs.length).toBeGreaterThan(0);
    // The tagged segments (words + interior gaps) cover the full expression extent.
    expect(segs.map((s) => s.textContent).join('')).toBe('leverage our reputation');
  });

  it('does not tag tokens outside the cue span', () => {
    const { getByText } = render(<PassageRenderer passage={makeMultiTokenCuePassage()} />);
    expect(getByText('We').closest('[data-cue-index]')).toBeNull();
  });

  it('makes the in-text badge an interactive prose-side handle linked to the rail item', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} />);
    const badge = getByTestId('notice-badge-1');
    expect(badge.getAttribute('role')).toBe('button');
    expect(badge.getAttribute('aria-controls')).toBe('notice-item-1');
  });

  it('previews a cue on badge hover and clears it on leave', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} />);
    const badge = getByTestId('notice-badge-1');
    fireEvent.mouseEnter(badge);
    expect(readingUiStore.getState().hoverCueIndex).toBe(1);
    fireEvent.mouseLeave(badge);
    expect(readingUiStore.getState().hoverCueIndex).toBeNull();
  });

  it('pins a cue when its badge is clicked', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} />);
    fireEvent.click(getByTestId('notice-badge-1'));
    expect(readingUiStore.getState().pinnedCueIndex).toBe(1);
  });

  it('lights an underline-only span with a faint category FILL when its cue is active', () => {
    readingUiStore.getState().setPinned(1); // cue #1 = connotation on the target word "restless"
    const { container } = render(<PassageRenderer passage={makePassage()} />);
    const seg = container.querySelector('[data-cue-index~="1"]') as HTMLElement;
    expect(seg.style.background).toBe(cueHighlight('connotation').fill);
    expect(seg.style.boxShadow).toBe(''); // fill channel, not ring
  });

  it('uses a RING (not a fill) for a cue inside a collocation chip — collision avoidance', () => {
    readingUiStore.getState().setPinned(2);
    const { container } = render(<PassageRenderer passage={makeCueInsideCollocationPassage()} />);
    const seg = container.querySelector('[data-cue-index~="2"]') as HTMLElement;
    expect(seg.style.background).toBe(''); // never double-fill the #E4EDF8 chip
    expect(seg.style.boxShadow).toContain('inset');
  });

  it('adds no highlight ink at rest, however many cues exist', () => {
    const { container } = render(<PassageRenderer passage={makePassage()} />);
    const seg = container.querySelector('[data-cue-index~="1"]') as HTMLElement;
    expect(seg.style.background).toBe('');
    expect(seg.style.boxShadow).toBe('');
  });
});

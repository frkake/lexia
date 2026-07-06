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
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 5 },
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

/** A multi-word collocation ("strike a bargain") whose own cue spans the whole chip. */
function makeMultiWordCollocationPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 6 },
    sentences: [{ tokens: ['They', 'strike', 'a', 'bargain', 'today', '.'], translationJa: '今日、取引をまとめる。' }],
    targetSpans: [],
    collocationSpans: [{ sentenceIndex: 0, tokenStart: 1, tokenEnd: 4, headWordId: 'bargain', collocationId: 'strike a bargain' }],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 }, // "strike a bargain"
        category: 'collocation',
        anchorText: 'strike a bargain',
        explanationJa: '交渉して合意する固定表現。',
      },
    ],
  };
  return tokenizer.index('p-strike', source);
}

/** A notice cue ("leverage", [2,3)) sitting INSIDE a collocation chip ("leverage our reputation"). */
function makeCueInsideCollocationPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 1, reviewCount: 0, approxWords: 6 },
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
    meta: { title: 'The Restless Boardroom', intent: 'business', level: 'B2', newCount: 1, reviewCount: 2, approxWords: 12 },
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

function makeListeningPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: {
      title: 'Morning voices',
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 6,
      listeningScene: {
        sceneKind: 'street_interview',
        noiseLevel: 'low',
        accent: 'in',
        speakers: [
          { speakerId: 'interviewer', label: 'Interviewer', role: 'interviewer', voiceProfileId: 'azure-in-neerja' },
          { speakerId: 'guest_1', label: 'Guest', role: 'guest', voiceProfileId: 'azure-in-prabhat' },
        ],
      },
    },
    sentences: [
      { speakerId: 'interviewer', tokens: ['How', 'is', 'your', 'morning', '?'], translationJa: '' },
      { speakerId: 'guest_1', tokens: ['It', 'is', 'busy', '.'], translationJa: '' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('p-listening', source);
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
      meta: { title: 'T', intent: 'business', level: 'B2', newCount: 1, reviewCount: 0, approxWords: 6 },
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

describe('<PassageRenderer/> sentence-level 2-column grid (3.1)', () => {
  it('renders one row per sentence with an English left cell and a Japanese right cell', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    // Row 0: English left holds the sentence tokens; right cell holds the injected aside.
    const en0 = getByTestId('sentence-en-0');
    expect(en0.textContent).toContain('board');
    expect(en0.textContent).toContain('restless');
    expect(getByTestId('sentence-aside-0')).toBeTruthy();
    // A row exists for each sentence.
    expect(getByTestId('sentence-row-0')).toBeTruthy();
    expect(getByTestId('sentence-row-1')).toBeTruthy();
  });

  it('injects the per-sentence translation into the matching right cell (correspondence holds)', () => {
    const { getByTestId } = render(
      <PassageRenderer
        passage={makePassage()}
        layout="grid"
        renderAside={(i) => <span data-testid={`ja-${i}`}>訳{i}</span>}
      />,
    );
    expect(getByTestId('sentence-aside-0').textContent).toContain('訳0');
    expect(getByTestId('sentence-aside-1').textContent).toContain('訳1');
    // The translation for sentence 1 must NOT leak into row 0's right cell.
    expect(getByTestId('sentence-aside-0').textContent).not.toContain('訳1');
  });

  it('tags each notice badge with a line-anchor cue index for measurement (2.1 integration)', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    const badge = getByTestId('notice-badge-1');
    expect(badge.getAttribute('data-line-anchor')).toBe('1');
  });

  it('anchors only the first occurrence of each study word for the unified guide', () => {
    const source: PassageOutput = {
      meta: { title: 'T', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 8 },
      sentences: [
        { tokens: ['The', 'deal', 'closed', '.'], translationJa: '' },
        { tokens: ['Another', 'deal', 'followed', '.'], translationJa: '' },
      ],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
        { sentenceIndex: 1, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
      ],
      collocationSpans: [],
      noticeCues: [],
    };
    const { getAllByText } = render(
      <PassageRenderer
        passage={tokenizer.index('dup', source)}
        layout="grid"
        guideAnchorIdByWordKey={{ deal: 'word:deal' }}
        guideNumberByWordKey={{ deal: 1 }}
      />,
    );
    const deals = getAllByText('deal');
    expect(deals[0]!.getAttribute('data-line-anchor')).toBe('word:deal');
    expect(deals[1]!.getAttribute('data-line-anchor')).toBeNull();
  });

  it('renders a numbered study-word guide badge only at the first occurrence', () => {
    const source: PassageOutput = {
      meta: { title: 'T', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 8 },
      sentences: [
        { tokens: ['The', 'deal', 'closed', '.'], translationJa: '' },
        { tokens: ['Another', 'deal', 'followed', '.'], translationJa: '' },
      ],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
        { sentenceIndex: 1, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
      ],
      collocationSpans: [],
      noticeCues: [],
    };
    const { getByTestId, getAllByTestId } = render(
      <PassageRenderer
        passage={tokenizer.index('dup', source)}
        layout="grid"
        guideAnchorIdByWordKey={{ deal: 'word:deal' }}
        guideNumberByWordKey={{ deal: 1 }}
      />,
    );
    expect(getByTestId('study-guide-badge-deal').textContent).toBe('1');
    expect(getAllByTestId('study-guide-badge-deal')).toHaveLength(1);
  });

  it('replaces an absorbed same-word notice badge with the study-word badge', () => {
    const source: PassageOutput = {
      meta: { title: 'T', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
      sentences: [{ tokens: ['The', 'deal', 'closed', '.'], translationJa: '' }],
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
      ],
      collocationSpans: [],
      noticeCues: [
        {
          index: 1,
          span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2 },
          category: 'connotation',
          wordId: 'deal',
          anchorText: 'deal',
          explanationJa: '商談らしい響き。',
        },
      ],
    };
    const { getByTestId, queryByTestId } = render(
      <PassageRenderer
        passage={tokenizer.index('absorbed', source)}
        layout="grid"
        guideAnchorIdByWordKey={{ deal: 'word:deal' }}
        guideTargetIdByCueIndex={{ 1: 'guide-item-word:deal' }}
        guideNumberByCueIndex={{ 1: 1 }}
        guideNumberByWordKey={{ deal: 1 }}
        absorbedCueIndexByIndex={{ 1: true }}
      />,
    );
    expect(getByTestId('study-guide-badge-deal').textContent).toBe('1');
    expect(queryByTestId('notice-badge-1')).toBeNull();
  });

  it('keeps the grid container flagged so the layout can be detected/styled', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    expect(getByTestId('passage-prose').getAttribute('data-layout')).toBe('grid');
  });

  it('defaults to the two-column grid with a rendered aside cell (asideEnabled true)', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    expect(getByTestId('sentence-row-0').style.gridTemplateColumns).toBe('minmax(0, 1.6fr) minmax(0, 1fr)');
    expect(getByTestId('sentence-aside-0')).toBeTruthy();
  });

  it('collapses to a single full-width column and drops the aside when asideEnabled is false (F-8①)', () => {
    const { getByTestId, queryByTestId } = render(
      <PassageRenderer passage={makePassage()} layout="grid" asideEnabled={false} />,
    );
    // Right translation column is gone; the English cell spans the whole width.
    expect(getByTestId('sentence-row-0').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(queryByTestId('sentence-aside-0')).toBeNull();
    expect(queryByTestId('sentence-aside-1')).toBeNull();
    expect(getByTestId('sentence-en-0')).toBeTruthy();
  });

  it('still defaults to flowing prose when no layout is given (old layout preserved)', () => {
    const { getByTestId, queryByTestId } = render(<PassageRenderer passage={makePassage()} />);
    expect(getByTestId('passage-prose').getAttribute('data-layout')).toBe('prose');
    expect(queryByTestId('sentence-row-0')).toBeNull();
  });
});

describe('<PassageRenderer/> listening scenes', () => {
  it('renders speaker labels without replacing the subtitle tokens', () => {
    const { getByTestId, getByText } = render(<PassageRenderer passage={makeListeningPassage()} layout="grid" />);
    expect(getByTestId('speaker-label-0').textContent).toBe('Interviewer');
    expect(getByTestId('speaker-label-1').textContent).toBe('Guest');
    expect(getByText('morning')).toBeTruthy();
    expect(getByText('busy')).toBeTruthy();
  });
});

describe('<PassageRenderer/> always-on annotation + focus escalation (3.2)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('shows every cue span with an always-on faint category FILL, no hover/pin needed (1.1)', () => {
    const { container } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    // cue #1 = connotation on "restless"; its span is tinted at rest in the new layout.
    const seg = container.querySelector('[data-cue-index~="1"]') as HTMLElement;
    expect(seg.style.background).toBe(cueHighlight('connotation').fill);
    expect(seg.style.boxShadow).toBe(''); // faint fill only at rest — no focus ring yet
  });

  it('escalates the focused cue to a deep category RING while keeping the always-on fill (1.6)', () => {
    readingUiStore.getState().setPinned(1);
    const { container } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    const seg = container.querySelector('[data-cue-index~="1"]') as HTMLElement;
    // Always-on fill is preserved …
    expect(seg.style.background).toBe(cueHighlight('connotation').fill);
    // … and the focus state adds the deep category ring.
    expect(seg.style.boxShadow).toContain(cueHighlight('connotation').ring);
  });

  it('does NOT draw a per-word ring inside a collocation chip at rest (chip tint + badge suffice)', () => {
    // Regression: each word of "strike a bargain" used to get its own inset ring, boxing every
    // word and cluttering the chip. At rest the chip's tint + number badge mark it — no ring.
    const { container } = render(<PassageRenderer passage={makeMultiWordCollocationPassage()} layout="grid" />);
    const segs = Array.from(container.querySelectorAll('[data-cue-index~="1"]')) as HTMLElement[];
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.style.boxShadow === '')).toBe(true); // no boxes per word at rest
    expect(segs.every((s) => s.style.background === '')).toBe(true); // chip owns the bg channel
  });

  it('escalates a chip-internal cue to a ring ONLY when focused (1.6)', () => {
    readingUiStore.getState().setPinned(1);
    const { container } = render(<PassageRenderer passage={makeMultiWordCollocationPassage()} layout="grid" />);
    const segs = Array.from(container.querySelectorAll('[data-cue-index~="1"]')) as HTMLElement[];
    // When focused, the chip's cue shows the inset ring (still no fill — chip owns the bg).
    expect(segs.some((s) => s.style.boxShadow.includes('inset'))).toBe(true);
  });

  it('keeps the legacy prose layout ink-free at rest (old behavior preserved)', () => {
    const { container } = render(<PassageRenderer passage={makePassage()} />);
    const seg = container.querySelector('[data-cue-index~="1"]') as HTMLElement;
    expect(seg.style.background).toBe('');
    expect(seg.style.boxShadow).toBe('');
  });
});

/** A cue spanning a discontinuous grammar relation ("no sooner ... than"), including the gap tokens. */
function makeDiscontinuousCuePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 9 },
    sentences: [
      { tokens: ['No', 'sooner', 'had', 'we', 'left', 'than', 'it', 'rained', '.'], translationJa: '出るやいなや雨が降った。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 6 }, // "No sooner had we left than"
        category: 'grammar_pattern',
        anchorText: 'No sooner had we left than',
        explanationJa: '過去完了＋倒置の固定表現。',
      },
    ],
  };
  return tokenizer.index('p-disc', source);
}

/** Two overlapping cues on the same token range ("set an agenda"): collocation + register. */
function makeOverlappingCuesPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 6 },
    sentences: [{ tokens: ['We', 'set', 'an', 'agenda', 'today', '.'], translationJa: '今日は議題を決めた。' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 }, // "set an agenda"
        category: 'collocation',
        anchorText: 'set an agenda',
        explanationJa: '定型の言い回し。',
      },
      {
        index: 2,
        span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, // "agenda" — overlaps cue #1
        category: 'register',
        anchorText: 'agenda',
        explanationJa: '会議で使うフォーマル語。',
      },
    ],
  };
  return tokenizer.index('p-overlap', source);
}

describe('<PassageRenderer/> discontinuous links, overlaps, audio non-collision (3.3)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('connects a discontinuous relation across the intervening gap tokens (1.2)', () => {
    const { container } = render(<PassageRenderer passage={makeDiscontinuousCuePassage()} layout="grid" />);
    const segs = Array.from(container.querySelectorAll('[data-cue-index~="1"]'));
    // The full expression — including the in-between words and the spaces — is connected.
    expect(segs.map((s) => s.textContent).join('')).toBe('No sooner had we left than');
  });

  it('co-lists a badge for each overlapping cue and tags the shared token with both indices (1.4)', () => {
    const { getByTestId, container } = render(<PassageRenderer passage={makeOverlappingCuesPassage()} layout="grid" />);
    // Both badges are present (co-listing) so each annotation stays distinguishable.
    expect(getByTestId('notice-badge-1').textContent).toBe('1');
    expect(getByTestId('notice-badge-2').textContent).toBe('2');
    // "agenda" belongs to both cues → its segment lists both cue indices.
    const shared = container.querySelector('[data-cue-index~="1"][data-cue-index~="2"]');
    expect(shared).not.toBeNull();
    expect(shared!.textContent).toContain('agenda');
  });

  it('keeps a cue cue-fill AND the audio follow-along emphasis on the same active token (1.3)', () => {
    // cue #1 = connotation on the target "restless"; make that token the TTS playhead token.
    const passage = makePassage();
    const restlessTokenId = passage.tokens.find((t) => t.text === 'restless')!.tokenId;
    const { container, getByText } = render(
      <PassageRenderer passage={passage} layout="grid" activeTokenId={restlessTokenId} />,
    );
    // Audio follow-along override: the active token renders in primary italic (not lost).
    const active = container.querySelector('[data-active="true"]') as HTMLElement;
    expect(active).not.toBeNull();
    expect(active.style.fontStyle).toBe('italic');
    // The category cue fill is still present on the wrapping segment (other cues not lost).
    const seg = getByText('restless').closest('[data-cue-index~="1"]') as HTMLElement;
    expect(seg.style.background).toBe(cueHighlight('connotation').fill);
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

describe('<PassageRenderer/> narrow inline notice popover (D-1 mobile fallback)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('opens an inline popover under the badge instead of scrolling to the rail, preserving scroll', () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      const { getByTestId, queryByTestId } = render(<PassageRenderer passage={makePassage()} isNarrow />);
      expect(queryByTestId('inline-notice-popover-1')).toBeNull();

      fireEvent.click(getByTestId('notice-badge-1'));
      // The cue is pinned (spotlight) and its explanation shows inline — no scroll to the stacked rail.
      expect(readingUiStore.getState().pinnedCueIndex).toBe(1);
      expect(scrollSpy).not.toHaveBeenCalled();
      expect(getByTestId('inline-notice-popover-1').textContent).toContain('不安・苛立ちを含む否定的な響き。');

      // The close button dismisses it.
      fireEvent.click(getByTestId('inline-notice-close-1'));
      expect(queryByTestId('inline-notice-popover-1')).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('re-tapping the same badge toggles the popover shut', () => {
    const { getByTestId, queryByTestId } = render(<PassageRenderer passage={makePassage()} isNarrow />);
    fireEvent.click(getByTestId('notice-badge-1'));
    expect(getByTestId('inline-notice-popover-1')).toBeTruthy();
    fireEvent.click(getByTestId('notice-badge-1'));
    expect(queryByTestId('inline-notice-popover-1')).toBeNull();
  });

  it('keeps the wide-layout behavior (no inline popover, still pins the cue) when not narrow', () => {
    const { getByTestId, queryByTestId } = render(<PassageRenderer passage={makePassage()} />);
    fireEvent.click(getByTestId('notice-badge-1'));
    // Wide layout: the badge pins the cue and scrolls to the rail (rail absent here) — never an inline popover.
    expect(readingUiStore.getState().pinnedCueIndex).toBe(1);
    expect(queryByTestId('inline-notice-popover-1')).toBeNull();
  });
});

/** A phrasal verb ("come up with") the model self-reported in expressionSpans (B-1 / B-2). */
function makeExpressionPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 9 },
    sentences: [
      { tokens: ['We', 'need', 'to', 'come', 'up', 'with', 'a', 'plan', '.'], translationJa: '計画を思いつく必要がある。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
    expressionSpans: [
      { span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 6 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '思いつく' },
    ],
  };
  return tokenizer.index('p-expr', source);
}

/** An idiom span ("take risks into account") that wraps a NEW target word ("risks"). */
function makeExpressionWithTargetPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 1, reviewCount: 0, approxWords: 6 },
    sentences: [{ tokens: ['They', 'take', 'risks', 'into', 'account', '.'], translationJa: 'リスクを考慮に入れる。' }],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'risks', surface: 'risks', masteryDensity: 'new' },
    ],
    collocationSpans: [],
    noticeCues: [],
    expressionSpans: [
      { span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 5 }, surface: 'take risks into account', category: 'idiom', meaningJa: '考慮に入れる' },
    ],
  };
  return tokenizer.index('p-expr-target', source);
}

describe('<PassageRenderer/> expression spans (B-1 / B-2)', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('marks a self-reported expression in-text with its category and connects the full extent', () => {
    const { container, getByText } = render(<PassageRenderer passage={makeExpressionPassage()} />);
    const segs = Array.from(container.querySelectorAll('[data-expression-category="phrasal_verb"]'));
    expect(segs.length).toBeGreaterThan(0);
    // The whole expression — words + interior gaps — carries the underline channel.
    expect(segs.map((s) => s.textContent).join('')).toBe('come up with');
    // Tokens outside the expression are untouched.
    expect(getByText('plan').closest('[data-expression-category]')).toBeNull();
  });

  it('surfaces the expression meaningJa as a title (legend-style gloss)', () => {
    const { container } = render(<PassageRenderer passage={makeExpressionPassage()} />);
    const seg = container.querySelector('[data-expression-category="phrasal_verb"]') as HTMLElement;
    expect(seg.getAttribute('title')).toBe('思いつく');
  });

  it('layers the expression underline over a target inside it without dropping the mastery encoding', () => {
    const { getByText } = render(<PassageRenderer passage={makeExpressionWithTargetPassage()} />);
    const risks = getByText('risks');
    // Target keeps its mastery-density encoding …
    expect(risks.getAttribute('data-kind')).toBe('new');
    // … and is additionally wrapped by the expression underline layer.
    expect(risks.closest('[data-expression-category="idiom"]')).not.toBeNull();
  });

  it('renders nothing extra for passages generated before expressionSpans existed (back-compat)', () => {
    const { container } = render(<PassageRenderer passage={makePassage()} />);
    expect(container.querySelector('[data-expression-category]')).toBeNull();
  });
});

/** A three-sentence passage split into two paragraphs (F-8②). */
function makeParagraphPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'B2', newCount: 0, reviewCount: 0, approxWords: 6 },
    sentences: [
      { tokens: ['Alpha', '.'], translationJa: 'ア。', paragraphIndex: 0 },
      { tokens: ['Beta', '.'], translationJa: 'イ。', paragraphIndex: 0 },
      { tokens: ['Gamma', '.'], translationJa: 'ウ。', paragraphIndex: 1 },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('p-para', source);
}

describe('<PassageRenderer/> paragraph structure (F-8②)', () => {
  it('widens the grid row gap only at a paragraph boundary', () => {
    const { getByTestId } = render(<PassageRenderer passage={makeParagraphPassage()} layout="grid" />);
    // row-1 is the last sentence of paragraph 0; the next sentence opens paragraph 1 → wide gap.
    expect(getByTestId('sentence-row-0').style.marginBottom).toBe('14px');
    expect(getByTestId('sentence-row-1').style.marginBottom).toBe('28px');
    expect(getByTestId('sentence-row-2').style.marginBottom).toBe('14px');
  });

  it('keeps uniform grid spacing for passages without paragraphIndex (back-compat)', () => {
    const { getByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    expect(getByTestId('sentence-row-0').style.marginBottom).toBe('14px');
    expect(getByTestId('sentence-row-1').style.marginBottom).toBe('14px');
  });

  it('splits the legacy prose into <p> blocks per paragraph', () => {
    const { container } = render(<PassageRenderer passage={makeParagraphPassage()} />);
    const paras = Array.from(container.querySelectorAll('p[data-paragraph-index]'));
    expect(paras.length).toBe(2);
    expect(paras[0]!.textContent).toContain('Alpha');
    expect(paras[0]!.textContent).toContain('Beta');
    expect(paras[1]!.textContent).toContain('Gamma');
  });

  it('renders prose as a single flow (no <p> blocks) when paragraphIndex is absent (back-compat)', () => {
    const { container, getByTestId } = render(<PassageRenderer passage={makePassage()} />);
    expect(getByTestId('passage-prose').getAttribute('data-layout')).toBe('prose');
    expect(container.querySelector('p')).toBeNull();
  });
});

// ── C-4: discontinuous cue lighting (extraSpans) + sentence syntax notes ──────
/** A discontinuous cue split into a main span ("No sooner") + an extraSpan ("than"). */
function makeExtraSpanCuePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'C1', newCount: 0, reviewCount: 0, approxWords: 8 },
    sentences: [
      { tokens: ['No', 'sooner', 'had', 'we', 'left', 'than', 'it', 'rained', '.'], translationJa: '出るやいなや雨が降った。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 2 }, // "No sooner"
        category: 'grammar_pattern',
        anchorText: 'No sooner',
        explanationJa: '〜するやいなや。',
        extraSpans: [{ sentenceIndex: 0, tokenStart: 5, tokenEnd: 6 }], // "than"
      },
    ],
  };
  return tokenizer.index('p-extra', source);
}

/** A passage with a sentence-level syntax note on the first (hard) sentence only. */
function makeSyntaxNotePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'T', intent: 'business', level: 'C1', newCount: 0, reviewCount: 0, approxWords: 12 },
    sentences: [
      { tokens: ['No', 'sooner', 'had', 'we', 'left', 'than', 'it', 'rained', '.'], translationJa: '出るやいなや雨が降った。' },
      { tokens: ['We', 'went', 'home', '.'], translationJa: '家に帰った。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
    syntaxNotes: [
      {
        sentenceIndex: 0,
        patternNameJa: '倒置（否定副詞句＋助動詞前置）',
        structureJa: '主節が倒置している。',
        readingJa: 'No sooner had we left → 出るやいなや / than it rained → 雨が降った',
        chunks: [{ tokenStart: 0, tokenEnd: 2, roleJa: '否定副詞句' }],
      },
    ],
  };
  return tokenizer.index('p-syntax', source);
}

describe('<PassageRenderer/> C-4 discontinuous cues + syntax notes', () => {
  beforeEach(() => readingUiStore.getState().reset());

  it('lights BOTH parts of a discontinuous cue (extraSpans) under one cue index, with a single badge', () => {
    const { getByTestId } = render(<PassageRenderer passage={makeExtraSpanCuePassage()} layout="grid" />);
    const en = getByTestId('sentence-en-0');
    const segs = Array.from(en.querySelectorAll('[data-cue-index~="1"]')) as HTMLElement[];
    const texts = segs.map((s) => s.textContent ?? '');
    // The "No sooner" head and the split "than" tail both belong to cue 1 (one glow group).
    expect(texts.some((t) => /No|sooner/.test(t))).toBe(true);
    expect(texts.some((t) => t.includes('than'))).toBe(true);
    // Only ONE in-text badge for the whole discontinuous expression (at the main span).
    expect(en.querySelectorAll('[data-testid="notice-badge-1"]').length).toBe(1);
  });

  it('renders a 構文 toggle only for sentences with a note, revealing the panel on click (C-4)', () => {
    const { getByTestId, queryByTestId } = render(<PassageRenderer passage={makeSyntaxNotePassage()} layout="grid" />);
    // Sentence 0 has a note → toggle present; sentence 1 has none → no toggle.
    const toggle = getByTestId('syntax-note-toggle-0');
    expect(queryByTestId('syntax-note-toggle-1')).toBeNull();
    // Collapsed until clicked.
    expect(queryByTestId('syntax-note-0')).toBeNull();
    fireEvent.click(toggle);
    const panel = getByTestId('syntax-note-0');
    expect(panel.textContent).toContain('倒置');
    expect(panel.textContent).toContain('否定副詞句'); // chunk role label
    expect(panel.textContent).toContain('やいなや'); // readingJa arrow chain
  });

  it('renders no 構文 toggle for a passage without syntax notes (back-compat)', () => {
    const { queryByTestId } = render(<PassageRenderer passage={makePassage()} layout="grid" />);
    expect(queryByTestId('syntax-note-toggle-0')).toBeNull();
  });
});

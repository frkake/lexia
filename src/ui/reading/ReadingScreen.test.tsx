// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReadingScreen } from './ReadingScreen';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { sessionStore } from '../../state/stores/sessionStore';
import { settingsStore } from '../../state/stores/settingsStore';
import { readingUiStore } from '../../state/stores/readingUiStore';
import type { IndexedPassage, PassageOutput, StoryPlan } from '../../types/domain';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'The Restless Boardroom', intent: 'business', level: 'B2', newCount: 4, reviewCount: 6, approxWords: 12 },
    sentences: [{ tokens: ['The', 'board', 'was', 'growing', 'restless', '.'], translationJa: '取締役会は苛立っていた。' }],
    targetSpans: [{ sentenceIndex: 0, tokenStart: 4, tokenEnd: 5, wordId: 'restless', surface: 'restless', masteryDensity: 'review' }],
    collocationSpans: [],
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

function makeStoryPlan(): StoryPlan {
  return {
    storyId: 'story_1',
    contentType: 'long_story',
    genre: 'fantasy',
    titleJa: '星の少女',
    synopsisJa: '少女が星を探す長い旅。',
    characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
    chapters: [
      { index: 0, headingJa: '第一章', beatJa: '旅立ち' },
      { index: 1, headingJa: '第二章', beatJa: '星の門を開く' },
    ],
  };
}

function renderScreen(props: Parameters<typeof ReadingScreen>[0] = {}) {
  return render(
    <MemoryRouter>
      <ReadingScreen {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() => {
    settingsStore.setState({ fontScale: 1, translationMode: 'off' });
    sessionStore.getState().reset();
    readingUiStore.getState().reset();
  });
});

describe('<ReadingScreen/>', () => {
  it('shows the title, scene-illustration placeholder and passage meta', () => {
    const { getByText, getAllByText } = renderScreen({ passage: makePassage() });
    expect(getAllByText('The Restless Boardroom').length).toBeGreaterThan(0);
    expect(getByText(/story illustration/)).toBeTruthy();
    expect(getAllByText(/新出\s*4\s*\/\s*復習\s*6/).length).toBeGreaterThan(0);
  });

  it('renders the annotated prose', () => {
    const { getByTestId } = renderScreen({ passage: makePassage() });
    const prose = within(getByTestId('passage-prose'));
    expect(prose.getByText('growing')).toBeTruthy();
    expect(prose.getByText('restless').getAttribute('data-kind')).toBe('review');
  });

  it('changes the body font size via the size control (4.6)', () => {
    const { getByLabelText, getByTestId } = renderScreen({ passage: makePassage() });
    expect(getByTestId('passage-prose').style.fontSize).toBe('19px');
    fireEvent.click(getByLabelText('文字を大きく'));
    expect(getByTestId('passage-prose').style.fontSize).not.toBe('19px');
  });

  it('opens word detail when a learning word is selected (4.5)', () => {
    const renderWordDetail = vi.fn((wordId: string, onClose: () => void) => (
      <div data-testid="detail">
        詳細: {wordId}
        <button onClick={onClose}>閉じる</button>
      </div>
    ));
    const { getByRole, getByText, getByTestId, queryByTestId } = renderScreen({ passage: makePassage(), renderWordDetail });
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(within(getByTestId('passage-prose')).getByText('restless'));
    expect(queryByTestId('detail')!.textContent).toContain('restless');
    fireEvent.click(getByTestId('detail'));
    expect(queryByTestId('detail')).toBeTruthy();
    fireEvent.click(getByRole('dialog', { name: '単語詳細' }));
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(within(getByTestId('passage-prose')).getByText('restless'));
    fireEvent.click(getByText('閉じる'));
    expect(queryByTestId('detail')).toBeNull();
  });

  it('shows the translation mode toggle and renders per-sentence translations in full mode', () => {
    act(() => settingsStore.setState({ translationMode: 'full' }));
    const { getByText } = renderScreen({ passage: makePassage() });
    expect(getByText('全文')).toBeTruthy(); // mode toggle
    expect(getByText('取締役会は苛立っていた。')).toBeTruthy(); // sentence translationJa
  });

  it('offers a mobile back affordance (12.4)', () => {
    const { getByLabelText } = renderScreen({ passage: makePassage() });
    expect(getByLabelText('戻る')).toBeTruthy();
  });

  it('renders a default rail with notices and study words (8.3 composition)', () => {
    const { getByText, getByTestId } = renderScreen({ passage: makePassage() });
    expect(getByText('この文章で気づきたいこと')).toBeTruthy();
    expect(getByTestId('study-word-restless')).toBeTruthy();
  });

  it('jumps to the matching in-text badge when a notice item is clicked', () => {
    const original = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      const { getByTestId } = renderScreen({ passage: makePassage() });
      fireEvent.click(getByTestId('notice-item-1'));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      // It scrolled the badge whose id matches the cue — the in-text marker, not some other node.
      expect(scrollSpy.mock.instances[0]).toBe(getByTestId('notice-badge-1'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('offers a completion action when read-through persistence is wired', () => {
    const onCompleteReading = vi.fn();
    const { getByTestId } = renderScreen({ passage: makePassage(), onCompleteReading });
    fireEvent.click(getByTestId('reading-complete'));
    expect(onCompleteReading).toHaveBeenCalledTimes(1);
  });

  it('offers a long-story continuation action when wired', () => {
    const onGenerateNextChapter = vi.fn();
    const { getByTestId } = renderScreen({ passage: makePassage(), onGenerateNextChapter });
    fireEvent.click(getByTestId('generate-next-chapter'));
    expect(onGenerateNextChapter).toHaveBeenCalledTimes(1);
  });

  it('shows continuation busy state and errors', () => {
    const { getByTestId, getByText } = renderScreen({
      passage: makePassage(),
      onGenerateNextChapter: vi.fn(),
      generatingNextChapter: true,
      nextChapterError: '続きを生成できませんでした。',
    });
    expect(getByTestId('generate-next-chapter').getAttribute('aria-busy')).toBe('true');
    expect(getByText('続きを生成しています…')).toBeTruthy();
    expect(getByText('続きを生成できませんでした。')).toBeTruthy();
  });

  it('opens story settings from the body page when a story plan is supplied', () => {
    const { getByTestId, getByRole, getByText, queryByRole } = renderScreen({
      passage: makePassage(),
      storyPlan: makeStoryPlan(),
    });
    fireEvent.click(getByTestId('story-settings'));
    expect(getByRole('dialog', { name: '物語設定' })).toBeTruthy();
    expect(getByText('キャラクター設定')).toBeTruthy();
    expect(getByText('Mia')).toBeTruthy();
    expect(getByText('プロット')).toBeTruthy();
    expect(getByText(/星の門を開く/)).toBeTruthy();
    fireEvent.click(getByText('キャラクター設定'));
    expect(getByRole('dialog', { name: '物語設定' })).toBeTruthy();
    fireEvent.click(getByRole('dialog', { name: '物語設定' }));
    expect(queryByRole('dialog', { name: '物語設定' })).toBeNull();
  });

  it('falls back to the in-progress session passage when none is passed', () => {
    act(() => sessionStore.getState().startPassage(makePassage(), 1_000));
    const { getByText } = renderScreen();
    expect(getByText('growing')).toBeTruthy();
  });

  it('reflects the active cue on the root so both columns can light from one attribute', () => {
    act(() => readingUiStore.getState().setPinned(1));
    const { container } = renderScreen({ passage: makePassage() });
    expect((container.firstChild as HTMLElement).getAttribute('data-active-cue')).toBe('1');
  });

  it('clears the pinned cue on Escape', () => {
    act(() => readingUiStore.getState().setPinned(1));
    renderScreen({ passage: makePassage() });
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(readingUiStore.getState().pinnedCueIndex).toBeNull();
  });
});

describe('<ReadingScreen/> 3-zone layout (feature-flagged, 6.1)', () => {
  it('keeps the legacy prose layout when the flag is off (default)', () => {
    const { getByTestId } = renderScreen({ passage: makePassage() });
    // Default off → flowing prose, no sentence grid rows.
    expect(getByTestId('passage-prose').getAttribute('data-layout')).toBe('prose');
  });

  it('renders the sentence-unit grid with right-cell translation when the flag is on', () => {
    act(() => settingsStore.setState({ translationMode: 'full' }));
    const { getByTestId } = renderScreen({ passage: makePassage(), newLayout: true });
    expect(getByTestId('passage-prose').getAttribute('data-layout')).toBe('grid');
    // The Japanese sits in the sentence's right cell (3.1).
    expect(getByTestId('sentence-aside-0').textContent).toContain('取締役会は苛立っていた。');
  });

  it('still shows the notice rail in the new layout (3-zone composition)', () => {
    const { getByText } = renderScreen({ passage: makePassage(), newLayout: true });
    expect(getByText('この文章で気づきたいこと')).toBeTruthy();
  });

  it('renders the anchor-aware NoticeRail even when a custom rail is injected (Blocker 2)', () => {
    // The real app injects its own rail (study words). The notice rail must STILL be the
    // ReadingScreen-owned, anchor-aware one — not bypassed — so it can line-align in the new layout.
    const { getByText, getByTestId } = renderScreen({
      passage: makePassage(),
      newLayout: true,
      rail: <div data-testid="injected-rail">学習する単語</div>,
    });
    // The owned NoticeRail is present (its heading) …
    expect(getByText('この文章で気づきたいこと')).toBeTruthy();
    // … the cue item is present so anchors can position it …
    expect(getByTestId('notice-item-1')).toBeTruthy();
    // … and the injected rail content is still rendered alongside it.
    expect(getByTestId('injected-rail').textContent).toContain('学習する単語');
  });

  it('does not duplicate the notice rail when no custom rail is injected', () => {
    const { getAllByText } = renderScreen({ passage: makePassage(), newLayout: true });
    // Exactly one notice rail heading — the owned one (no double render).
    expect(getAllByText('この文章で気づきたいこと')).toHaveLength(1);
  });

  it('widens the body container in the wide grid so the English column is not strangled', () => {
    // Wide viewport (matchMedia → false): the 2-column grid needs more room than the legacy 600px
    // single column, otherwise the English text is squeezed into a narrow strip.
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    try {
      const { getByTestId } = renderScreen({ passage: makePassage(), newLayout: true });
      const bodyWidth = parseFloat(getByTestId('reading-body').style.maxWidth);
      expect(bodyWidth).toBeGreaterThan(600);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the legacy single-column body width (600px) when the new layout is off', () => {
    const { getByTestId } = renderScreen({ passage: makePassage() });
    expect(getByTestId('reading-body').style.maxWidth).toBe('600px');
  });

  it('gives the reading column more weight than the rail in the wide grid (EN+JA needs the room)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    try {
      const { container } = renderScreen({ passage: makePassage(), newLayout: true });
      const main = container.querySelector('.reading-main') as HTMLElement;
      // The legacy split was 1.9; the 3-zone layout holds two columns in the main so it must get
      // a larger share than that to keep the English readable next to the rail.
      expect(parseFloat(main.style.flexGrow || main.style.flex)).toBeGreaterThan(1.9);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the wide 3-zone arrangement on a wide viewport', () => {
    // matchMedia(max-width:600px) → false (wide).
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    try {
      const { container } = renderScreen({ passage: makePassage(), newLayout: true });
      expect((container.firstChild as HTMLElement).getAttribute('data-reading-zones')).toBe('wide');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('flattens to the narrow arrangement on a narrow viewport (Req 3.3 mobile fallback)', () => {
    // matchMedia(max-width:600px) → true (narrow): line-alignment disabled, rail flattens.
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q,
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    try {
      const { container, getByTestId } = renderScreen({ passage: makePassage(), newLayout: true });
      expect((container.firstChild as HTMLElement).getAttribute('data-reading-zones')).toBe('narrow');
      // The rail item is NOT absolutely positioned when narrow (flat-flow fallback).
      expect(getByTestId('notice-item-1').style.position).not.toBe('absolute');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

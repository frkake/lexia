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
    characters: [
      {
        name: 'Mia',
        role: '主人公',
        descriptionJa: '好奇心旺盛な少女',
        portraitIllustrationUrl: 'data:image/png;base64,PORTRAIT',
        fullBodyIllustrationUrl: 'data:image/png;base64,FULLBODY',
      },
    ],
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

  it('renders a generated scene illustration when the passage has one', () => {
    const passage = makePassage();
    passage.source.meta.sceneIllustrationUrl = 'data:image/png;base64,SCENE';
    const { getByAltText, queryByText } = renderScreen({ passage });
    const image = getByAltText('The Restless Boardroom の場面イラスト') as HTMLImageElement;
    expect(image.src).toContain('data:image/png;base64,SCENE');
    expect(image.style.objectFit).toBe('contain');
    expect((image.parentElement as HTMLElement).style.aspectRatio).toBe('3 / 2');
    expect(queryByText(/story illustration/)).toBeNull();
  });

  it('offers an on-demand scene illustration regeneration action when wired', () => {
    const passage = makePassage();
    passage.source.meta.sceneIllustrationUrl = 'data:image/png;base64,SCENE';
    const onRegenerateIllustration = vi.fn();
    const { getByTestId } = renderScreen({ passage, onRegenerateIllustration });
    fireEvent.click(getByTestId('regenerate-passage-illustration'));
    expect(onRegenerateIllustration).toHaveBeenCalledTimes(1);
  });

  it('shows scene illustration regeneration busy and error states', () => {
    const { getByTestId, getByRole, getByText } = renderScreen({
      passage: makePassage(),
      onRegenerateIllustration: vi.fn(),
      regeneratingIllustration: true,
      illustrationError: '本文イラストを再生成できませんでした。',
    });
    const button = getByTestId('regenerate-passage-illustration') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByText('生成しています…')).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('本文イラストを再生成できませんでした。');
  });

  it('shows a failure banner and regenerate button when the annotation pass failed (F-6)', () => {
    const passage = makePassage();
    passage.source.meta.annotationStatus = 'failed';
    const onRegenerateAnnotation = vi.fn();
    const { getByTestId } = renderScreen({ passage, onRegenerateAnnotation });
    expect(getByTestId('annotation-status-banner').textContent).toContain('注釈の生成に失敗しました');
    fireEvent.click(getByTestId('regenerate-annotation'));
    expect(onRegenerateAnnotation).toHaveBeenCalledTimes(1);
  });

  it('shows a partial-annotation message when the pass only partly completed (F-6)', () => {
    const passage = makePassage();
    passage.source.meta.annotationStatus = 'partial';
    const { getByTestId } = renderScreen({ passage, onRegenerateAnnotation: vi.fn() });
    expect(getByTestId('annotation-status-banner').textContent).toContain('注釈の一部だけ生成されました');
  });

  it('hides the annotation banner when the pass completed (or was never run)', () => {
    const complete = makePassage();
    complete.source.meta.annotationStatus = 'complete';
    const { queryByTestId } = renderScreen({ passage: complete, onRegenerateAnnotation: vi.fn() });
    expect(queryByTestId('annotation-status-banner')).toBeNull();
    // Absent status (a gateway/mock without the enrichment) also shows no banner.
    const { queryByTestId: queryUnset } = renderScreen({ passage: makePassage(), onRegenerateAnnotation: vi.fn() });
    expect(queryUnset('annotation-status-banner')).toBeNull();
  });

  it('shows annotation regeneration busy and error states', () => {
    const passage = makePassage();
    passage.source.meta.annotationStatus = 'failed';
    const { getByTestId, getByText } = renderScreen({
      passage,
      onRegenerateAnnotation: vi.fn(),
      regeneratingAnnotation: true,
      annotationError: '注釈を再生成できませんでした。時間をおいて再試行してください。',
    });
    const button = getByTestId('regenerate-annotation') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByText('生成しています…')).toBeTruthy();
    expect(getByText('注釈を再生成できませんでした。時間をおいて再試行してください。')).toBeTruthy();
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
    expect(getByText('学習ガイド')).toBeTruthy();
    expect(getByTestId('guide-item-word:restless')).toBeTruthy();
    // D-1: the absorbed notice detail lives in the expand-on-click card body.
    fireEvent.click(getByTestId('guide-item-word:restless'));
    expect(getByTestId('guide-absorbed-notice-1').textContent).toContain('不安・苛立ちを含む否定的な響き。');
  });

  it('jumps to the study-word badge when an absorbed notice is clicked', () => {
    const original = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      const { getByTestId, queryByTestId } = renderScreen({ passage: makePassage() });
      // Expand the study card so its absorbed notice is rendered, then click it.
      fireEvent.click(getByTestId('guide-item-word:restless'));
      fireEvent.click(getByTestId('guide-absorbed-notice-1'));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(queryByTestId('notice-badge-1')).toBeNull();
      expect(scrollSpy.mock.instances[0]).toBe(getByTestId('study-guide-badge-restless'));
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

  it('fires a lookup callback when a study word detail is opened (C-5d)', () => {
    const onOpenWordDetail = vi.fn();
    const { getByTestId } = renderScreen({ passage: makePassage(), onOpenWordDetail });
    fireEvent.click(within(getByTestId('passage-prose')).getByText('restless'));
    expect(onOpenWordDetail).toHaveBeenCalledWith('restless');
  });

  it('shows read-through completion feedback with credit counts and cannot be re-recorded (C-5d)', async () => {
    const onCompleteReading = vi.fn().mockResolvedValue({ total: 1, needReview: 0 });
    const { getByTestId, findByTestId, queryByTestId } = renderScreen({ passage: makePassage(), onCompleteReading });
    fireEvent.click(getByTestId('reading-complete'));
    const summary = await findByTestId('reading-completed-summary');
    expect(summary.textContent).toContain('読了済み ✓');
    expect(summary.textContent).toContain('1 語にクレジット');
    expect(summary.textContent).toContain('0 語は要復習');
    expect(queryByTestId('reading-complete')).toBeNull(); // record button is gone — no re-record
    expect(getByTestId('reading-completed-review')).toBeTruthy();
    expect(getByTestId('reading-completed-generate')).toBeTruthy();
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
    const onRegenerateStoryCharacter = vi.fn();
    const { getByAltText, getByTestId, getByRole, getByText, queryByRole } = renderScreen({
      passage: makePassage(),
      storyPlan: makeStoryPlan(),
      onRegenerateStoryCharacter,
    });
    fireEvent.click(getByTestId('story-settings'));
    expect(getByRole('dialog', { name: '物語設定' })).toBeTruthy();
    expect(getByText('キャラクター設定')).toBeTruthy();
    expect(getByText('Mia')).toBeTruthy();
    const image = getByAltText('Mia') as HTMLImageElement;
    expect(image.src).toContain('PORTRAIT');
    expect(image.style.objectFit).toBe('contain');
    expect(image.style.objectPosition).toBe('center top');
    expect(getByText('プロット')).toBeTruthy();
    expect(getByText(/星の門を開く/)).toBeTruthy();
    fireEvent.click(getByTestId('regenerate-story-character-0'));
    expect(onRegenerateStoryCharacter).toHaveBeenCalledWith(0);
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
    expect(getByText('学習ガイド')).toBeTruthy();
  });

  it('renders one unified guide with enriched study words when they are injected', () => {
    const { getByText, getByTestId } = renderScreen({
      passage: makePassage(),
      newLayout: true,
      studyWords: [{ wordId: 'restless', surface: 'restless', meaningJa: '落ち着かない' }],
    });
    expect(getByText('学習ガイド')).toBeTruthy();
    // The gloss shows on the collapsed summary; the absorbed notice appears once the card is expanded.
    expect(getByTestId('guide-item-word:restless').textContent).toContain('落ち着かない');
    fireEvent.click(getByTestId('guide-item-word:restless'));
    expect(getByTestId('guide-absorbed-notice-1')).toBeTruthy();
  });

  it('does not render the old split notice heading', () => {
    const { getAllByText, queryByText } = renderScreen({ passage: makePassage(), newLayout: true });
    expect(getAllByText('学習ガイド')).toHaveLength(1);
    expect(queryByText('この文章で気づきたいこと')).toBeNull();
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
      // The guide item is NOT absolutely positioned when narrow (flat-flow fallback).
      expect(getByTestId('guide-item-word:restless').style.position).not.toBe('absolute');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── F-2: saved-position restore ──────────────────────────────────────────────

function makeMultiSentencePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'Long Read', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 40 },
    sentences: Array.from({ length: 8 }, (_, i) => ({ tokens: ['Sentence', String(i), '.'], translationJa: `${i}文目。` })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('long1', source);
}

describe('<ReadingScreen/> saved-position restore (F-2)', () => {
  let scrolled: { el: HTMLElement; opts: unknown }[] = [];

  beforeEach(() => {
    scrolled = [];
    // jsdom has no layout/scroll; capture scrollIntoView targets and run rAF synchronously.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement, opts: unknown) {
        scrolled.push({ el: this, opts });
      },
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    vi.unstubAllGlobals();
  });

  it('centers the saved sentence and shows the resume snackbar when reopening mid-passage', () => {
    act(() => {
      sessionStore.getState().startPassage(makeMultiSentencePassage(), 1_000);
      sessionStore.getState().updateProgress(3);
    });
    const { getByTestId } = renderScreen(); // no passage prop → uses the session passage

    expect(getByTestId('reading-restore-notice').textContent).toContain('前回の位置から再開しました');
    const centered = scrolled.find((s) => (s.el.getAttribute('data-sentence-index')) === '3');
    expect(centered).toBeTruthy();
    expect(centered!.opts).toMatchObject({ block: 'center' });
  });

  it('does not show the snackbar when opening at the start (sentence 0)', () => {
    act(() => {
      sessionStore.getState().startPassage(makeMultiSentencePassage(), 1_000);
    });
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('reading-restore-notice')).toBeNull();
  });

  it('"先頭から読む" resets the position to the top and dismisses the snackbar', () => {
    act(() => {
      sessionStore.getState().startPassage(makeMultiSentencePassage(), 1_000);
      sessionStore.getState().updateProgress(3);
    });
    const { getByTestId, queryByTestId } = renderScreen();

    act(() => {
      fireEvent.click(getByTestId('reading-restart-top'));
    });
    expect(sessionStore.getState().sentenceIndex).toBe(0);
    expect(queryByTestId('reading-restore-notice')).toBeNull();
  });

  it('does not track/restore a standalone passage prop that is not the session passage', () => {
    // Session holds a DIFFERENT passage at a non-zero position; the prop passage must be untouched.
    act(() => {
      sessionStore.getState().startPassage(makeMultiSentencePassage(), 1_000);
      sessionStore.getState().updateProgress(3);
    });
    const { queryByTestId } = renderScreen({ passage: makePassage() });
    expect(queryByTestId('reading-restore-notice')).toBeNull();
  });
});

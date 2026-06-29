// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReadingScreen } from './ReadingScreen';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { sessionStore } from '../../state/stores/sessionStore';
import { settingsStore } from '../../state/stores/settingsStore';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

function makePassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'The Restless Boardroom', theme: 'negotiation', level: 'B2', newCount: 4, reviewCount: 6, approxWords: 12 },
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
    const { getByText, getByTestId, queryByTestId } = renderScreen({ passage: makePassage(), renderWordDetail });
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(within(getByTestId('passage-prose')).getByText('restless'));
    expect(queryByTestId('detail')!.textContent).toContain('restless');
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

  it('falls back to the in-progress session passage when none is passed', () => {
    act(() => sessionStore.getState().startPassage(makePassage(), 1_000));
    const { getByText } = renderScreen();
    expect(getByText('growing')).toBeTruthy();
  });
});

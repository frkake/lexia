// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { SentenceTranslation, TranslationModeToggle } from './SentenceTranslation';
import { settingsStore } from '../../state/stores/settingsStore';

const JA = '取締役会は次第に苛立ちを募らせていた。';

beforeEach(() => {
  act(() => settingsStore.setState({ translationMode: 'off' }));
});

describe('<SentenceTranslation/>', () => {
  it('shows nothing when the mode is off (5.2)', () => {
    const { queryByText } = render(<SentenceTranslation text={JA} mode="off" />);
    expect(queryByText(JA)).toBeNull();
  });

  it('always shows the translation in full mode (5.4)', () => {
    const { getByText } = render(<SentenceTranslation text={JA} mode="full" />);
    expect(getByText(JA)).toBeTruthy();
  });

  it('toggles a single sentence on demand in per-sentence mode (5.3/5.5)', () => {
    const { getByText, queryByText } = render(<SentenceTranslation text={JA} mode="per_sentence" />);
    expect(queryByText(JA)).toBeNull();
    fireEvent.click(getByText(/この文の和訳を表示/));
    expect(getByText(JA)).toBeTruthy();
    fireEvent.click(getByText(/和訳を隠す/));
    expect(queryByText(JA)).toBeNull();
  });
});

describe('<SentenceTranslation/> right-cell (aside) placement (3.1/3.4)', () => {
  it('keeps the 3 modes working when placed in the right cell: off shows nothing', () => {
    const { queryByText } = render(<SentenceTranslation text={JA} mode="off" placement="aside" />);
    expect(queryByText(JA)).toBeNull();
  });

  it('shows the translation in full mode within the right cell', () => {
    const { getByText, getByTestId } = render(<SentenceTranslation text={JA} mode="full" placement="aside" />);
    expect(getByText(JA)).toBeTruthy();
    // The aside placement is flagged so the layout/CSS can style + fall back on narrow widths.
    expect(getByTestId('sentence-translation').getAttribute('data-placement')).toBe('aside');
  });

  it('still toggles per-sentence on demand in the right cell', () => {
    const { getByText, queryByText } = render(<SentenceTranslation text={JA} mode="per_sentence" placement="aside" />);
    expect(queryByText(JA)).toBeNull();
    fireEvent.click(getByText(/この文の和訳を表示/));
    expect(getByText(JA)).toBeTruthy();
  });

  it('defaults to block placement (legacy below-the-sentence) when no placement is given', () => {
    const { getByTestId } = render(<SentenceTranslation text={JA} mode="full" />);
    expect(getByTestId('sentence-translation').getAttribute('data-placement')).toBe('block');
  });
});

describe('<SentenceTranslation/> new-element emphasis on the JA side (4.1/4.3/4.4)', () => {
  const TEXT = '彼女は粘り強いままだった。'; // "粘り強い" = chars [3,7)

  it('underlines only the new-element slice of the translation (4.1)', () => {
    const { container, getByTestId } = render(
      <SentenceTranslation
        text={TEXT}
        mode="full"
        spans={[{ charStart: 3, charEnd: 7, refType: 'word', wordId: 'resilient', isNew: true }]}
      />,
    );
    const marked = container.querySelector('[data-translation-new="true"]') as HTMLElement;
    expect(marked).not.toBeNull();
    expect(marked.textContent).toBe('粘り強い');
    expect(marked.style.borderBottom).toContain('solid');
    // The whole sentence still reads correctly (un-marked parts preserved around the emphasis).
    expect(getByTestId('sentence-translation').textContent).toBe(TEXT);
  });

  it('does NOT underline a span that is not new (review/known) (4.4)', () => {
    const { container } = render(
      <SentenceTranslation
        text={TEXT}
        mode="full"
        spans={[{ charStart: 3, charEnd: 7, refType: 'word', wordId: 'resilient', isNew: false }]}
      />,
    );
    expect(container.querySelector('[data-translation-new="true"]')).toBeNull();
  });

  it('individually emphasizes multiple new elements in one sentence (4.3)', () => {
    // "速く走り、強く跳んだ。" — mark "速く" [0,2) and "強く" [5,7).
    const text = '速く走り、強く跳んだ。';
    const { container } = render(
      <SentenceTranslation
        text={text}
        mode="full"
        spans={[
          { charStart: 0, charEnd: 2, refType: 'word', isNew: true },
          { charStart: 5, charEnd: 7, refType: 'word', isNew: true },
        ]}
      />,
    );
    const marks = Array.from(container.querySelectorAll('[data-translation-new="true"]'));
    expect(marks.map((m) => m.textContent)).toEqual(['速く', '強く']);
  });

  it('renders plain text when there are no spans (back-compat)', () => {
    const { container, getByText } = render(<SentenceTranslation text={TEXT} mode="full" />);
    expect(container.querySelector('[data-translation-new="true"]')).toBeNull();
    expect(getByText(TEXT)).toBeTruthy();
  });
});

describe('<TranslationModeToggle/>', () => {
  it('offers the three translation modes (5.1)', () => {
    const { getByText } = render(<TranslationModeToggle />);
    expect(getByText('オフ')).toBeTruthy();
    expect(getByText('文ごと')).toBeTruthy();
    expect(getByText('全文')).toBeTruthy();
  });

  it('persists the selected mode to settings', () => {
    const { getByText } = render(<TranslationModeToggle />);
    fireEvent.click(getByText('全文'));
    expect(settingsStore.getState().translationMode).toBe('full');
    fireEvent.click(getByText('文ごと'));
    expect(settingsStore.getState().translationMode).toBe('per_sentence');
  });
});

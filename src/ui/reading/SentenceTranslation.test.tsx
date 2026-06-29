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

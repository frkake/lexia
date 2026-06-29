// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { WordbookScreen, type WordbookEntry } from './WordbookScreen';

const WORDS: WordbookEntry[] = [
  { wordId: 'mitigate', headword: 'mitigate', gloss: '和らげる', stage: 'Learning' },
  { wordId: 'leverage', headword: 'leverage', gloss: '活用する', stage: 'Consolidating' },
  { wordId: 'candid', headword: 'candid', gloss: '率直な', stage: 'Learning' },
  { wordId: 'erode', headword: 'erode', gloss: '蝕む', stage: 'New' },
];

function renderScreen(props: Partial<Parameters<typeof WordbookScreen>[0]> = {}) {
  return render(<WordbookScreen words={WORDS} {...props} />);
}

describe('<WordbookScreen/>', () => {
  it('lists every word with a mastery dot and gloss (11.1)', () => {
    const { getByTestId, getByText } = renderScreen();
    const list = within(getByTestId('wordbook-list'));
    expect(list.getAllByTestId('mastery-dot').length).toBe(4);
    expect(getByText('和らげる')).toBeTruthy();
    expect(getByTestId('wordbook-total').textContent).toMatch(/全\s*4\s*語/);
  });

  it('filters the list by mastery stage (11.2)', () => {
    const { getByTestId, queryByTestId } = renderScreen();
    fireEvent.click(getByTestId('filter-Learning'));
    expect(getByTestId('word-row-mitigate')).toBeTruthy();
    expect(getByTestId('word-row-candid')).toBeTruthy();
    expect(queryByTestId('word-row-leverage')).toBeNull();
    expect(queryByTestId('word-row-erode')).toBeNull();
  });

  it('searches by headword or gloss (11.2)', () => {
    const { getByLabelText, getByTestId, queryByTestId } = renderScreen();
    const search = getByLabelText('単語を検索');
    fireEvent.change(search, { target: { value: 'lev' } });
    expect(getByTestId('word-row-leverage')).toBeTruthy();
    expect(queryByTestId('word-row-mitigate')).toBeNull();

    fireEvent.change(search, { target: { value: '率直' } });
    expect(getByTestId('word-row-candid')).toBeTruthy();
    expect(queryByTestId('word-row-leverage')).toBeNull();
  });

  it('opens the word detail card when a word is selected (11.3)', () => {
    const renderWordDetail = vi.fn((wordId: string, onClose: () => void) => (
      <div data-testid="detail">
        詳細: {wordId}
        <button onClick={onClose}>閉じる</button>
      </div>
    ));
    const { getByTestId, getByText, queryByTestId } = renderScreen({ renderWordDetail });
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(getByTestId('word-row-mitigate'));
    expect(queryByTestId('detail')!.textContent).toContain('mitigate');
    fireEvent.click(getByText('閉じる'));
    expect(queryByTestId('detail')).toBeNull();
  });

  it('shows an empty state when nothing matches', () => {
    const { getByTestId, getByText } = renderScreen();
    fireEvent.click(getByTestId('filter-Mastered'));
    expect(getByText(/該当する単語がありません/)).toBeTruthy();
  });
});

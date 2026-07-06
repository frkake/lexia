// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { WordbookScreen, type WordbookEntry } from './WordbookScreen';

const WORDS: WordbookEntry[] = [
  { wordId: 'mitigate', headword: 'mitigate', gloss: '和らげる', stage: 'Learning', due: true },
  { wordId: 'leverage', headword: 'leverage', gloss: '活用する', stage: 'Consolidating' },
  { wordId: 'candid', headword: 'candid', gloss: '率直な', stage: 'Learning' },
  { wordId: 'erode', headword: 'erode', gloss: '蝕む', stage: 'New', due: true },
];

const WITH_SUSPENDED: WordbookEntry[] = [
  ...WORDS,
  { wordId: 'ubiquitous', headword: 'ubiquitous', gloss: '至る所にある', stage: 'Mastered', suspended: true },
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

  it('filters the list by due review status', () => {
    const { getByTestId, queryByTestId, getAllByText } = renderScreen();
    fireEvent.click(getByTestId('filter-due'));
    expect(getByTestId('word-row-mitigate')).toBeTruthy();
    expect(getByTestId('word-row-erode')).toBeTruthy();
    expect(queryByTestId('word-row-leverage')).toBeNull();
    expect(queryByTestId('word-row-candid')).toBeNull();
    expect(getAllByText('要復習').length).toBeGreaterThanOrEqual(2);
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
    const { getByRole, getByTestId, getByText, queryByTestId } = renderScreen({ renderWordDetail });
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(getByTestId('word-row-mitigate'));
    // The detail card now lives inside the shared accessible ModalOverlay (D-3).
    expect(getByRole('dialog', { name: '単語詳細' })).toBeTruthy();
    expect(queryByTestId('detail')!.textContent).toContain('mitigate');
    // Clicking inside the panel keeps it open; a backdrop mousedown dismisses it.
    fireEvent.click(getByTestId('detail'));
    expect(queryByTestId('detail')).toBeTruthy();
    fireEvent.mouseDown(getByTestId('modal-backdrop'));
    expect(queryByTestId('detail')).toBeNull();
    fireEvent.click(getByTestId('word-row-mitigate'));
    fireEvent.click(getByText('閉じる'));
    expect(queryByTestId('detail')).toBeNull();
  });

  it('shows an empty state when nothing matches', () => {
    const { getByTestId, getByText } = renderScreen();
    fireEvent.click(getByTestId('filter-Mastered'));
    expect(getByText(/該当する単語がありません/)).toBeTruthy();
  });

  it('hides the「除外中」filter when there are no suspended words (C-5d)', () => {
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('filter-suspended')).toBeNull();
  });

  it('keeps suspended words out of the default view and lists them under「除外中」(C-5d)', () => {
    const { getByTestId, queryByTestId } = render(<WordbookScreen words={WITH_SUSPENDED} />);
    // Default (all) view excludes the suspended word.
    expect(queryByTestId('word-row-ubiquitous')).toBeNull();
    expect(getByTestId('word-row-mitigate')).toBeTruthy();
    // The「除外中」filter shows only suspended words.
    fireEvent.click(getByTestId('filter-suspended'));
    expect(getByTestId('word-row-ubiquitous')).toBeTruthy();
    expect(queryByTestId('word-row-mitigate')).toBeNull();
  });

  it('suspends an active word and restores a suspended one through the row actions (C-5d)', () => {
    const onSuspend = vi.fn();
    const onRestore = vi.fn();
    const { getByTestId } = render(<WordbookScreen words={WITH_SUSPENDED} onSuspend={onSuspend} onRestore={onRestore} />);
    fireEvent.click(getByTestId('suspend-mitigate'));
    expect(onSuspend).toHaveBeenCalledWith('mitigate');
    fireEvent.click(getByTestId('filter-suspended'));
    fireEvent.click(getByTestId('restore-ubiquitous'));
    expect(onRestore).toHaveBeenCalledWith('ubiquitous');
  });

  // ── A-3-2 / C-5c: selection mode ────────────────────────────────────────────
  it('hides the「選択」toggle unless a weave or review handler is supplied', () => {
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('wordbook-select-toggle')).toBeNull();
  });

  it('weaves the checked words into a passage in selection order (A-3-2)', () => {
    const onWeaveWords = vi.fn();
    const { getByTestId } = renderScreen({ onWeaveWords });
    // Rows open the detail card until selection mode is on.
    fireEvent.click(getByTestId('wordbook-select-toggle'));
    expect(getByTestId('wordbook-selection-footer')).toBeTruthy();
    // Empty selection → the weave button is disabled.
    expect((getByTestId('wordbook-weave-selected') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(getByTestId('word-row-candid'));
    fireEvent.click(getByTestId('word-row-mitigate'));
    expect(getByTestId('wordbook-selected-count').textContent).toBe('2');
    expect((getByTestId('word-row-candid') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(getByTestId('wordbook-weave-selected'));
    expect(onWeaveWords).toHaveBeenCalledWith(['candid', 'mitigate']);
  });

  it('toggles a checked word off, and scopes a review to the checked words (C-5c)', () => {
    const onReviewWords = vi.fn();
    const { getByTestId } = renderScreen({ onReviewWords });
    fireEvent.click(getByTestId('wordbook-select-toggle'));
    fireEvent.click(getByTestId('word-row-erode'));
    fireEvent.click(getByTestId('word-row-leverage'));
    fireEvent.click(getByTestId('word-row-erode')); // un-check erode
    expect(getByTestId('wordbook-selected-count').textContent).toBe('1');
    fireEvent.click(getByTestId('wordbook-review-selected'));
    expect(onReviewWords).toHaveBeenCalledWith(['leverage']);
  });

  // ── D-3: sort / counts / gloss / due labels ─────────────────────────────────
  const NOW = Date.UTC(2026, 6, 6, 3, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  const SORTABLE: WordbookEntry[] = [
    { wordId: 'beta', headword: 'beta', glosses: ['ベータ', '二番目'], stage: 'Learning', dueAt: NOW + 2 * DAY, stability: 3 },
    { wordId: 'alpha', headword: 'alpha', glosses: ['アルファ'], stage: 'Learning', dueAt: NOW, stability: 9 },
    { wordId: 'gamma', headword: 'gamma', glosses: ['ガンマ'], stage: 'New', dueAt: NOW + DAY, stability: undefined },
  ];

  const rowOrder = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('[data-testid^="word-item-"]')).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('word-item-', ''),
    );

  it('defaults to the dueAsc sort (期限が近い順) — soonest due first', () => {
    const { getByTestId } = render(<WordbookScreen words={SORTABLE} now={NOW} />);
    expect(rowOrder(getByTestId('wordbook-list'))).toEqual(['alpha', 'gamma', 'beta']);
    expect((getByTestId('wordbook-sort') as HTMLSelectElement).value).toBe('dueAsc');
  });

  it('sorts ABC and by stability, and reports the choice via onSortChange', () => {
    const onSortChange = vi.fn();
    const { getByTestId } = render(<WordbookScreen words={SORTABLE} now={NOW} onSortChange={onSortChange} />);
    fireEvent.change(getByTestId('wordbook-sort'), { target: { value: 'abc' } });
    expect(onSortChange).toHaveBeenCalledWith('abc');
    expect(rowOrder(getByTestId('wordbook-list'))).toEqual(['alpha', 'beta', 'gamma']);
    // stabilityAsc: weakest memory first; New (undefined stability) sinks to the bottom.
    fireEvent.change(getByTestId('wordbook-sort'), { target: { value: 'stabilityAsc' } });
    expect(rowOrder(getByTestId('wordbook-list'))).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('seeds the sort from initialSort', () => {
    const { getByTestId } = render(<WordbookScreen words={SORTABLE} now={NOW} initialSort="abc" />);
    expect((getByTestId('wordbook-sort') as HTMLSelectElement).value).toBe('abc');
    expect(rowOrder(getByTestId('wordbook-list'))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('shows per-filter count badges', () => {
    const { getByTestId } = render(<WordbookScreen words={SORTABLE} now={NOW} />);
    expect(getByTestId('filter-count-all').textContent).toBe('3');
    expect(getByTestId('filter-count-Learning').textContent).toBe('2');
    expect(getByTestId('filter-count-New').textContent).toBe('1');
    expect(getByTestId('filter-count-Mastered').textContent).toBe('0');
  });

  it('renders up to 2 meanings and a relative due label', () => {
    const { getByTestId } = render(<WordbookScreen words={SORTABLE} now={NOW} />);
    const beta = within(getByTestId('word-item-beta'));
    expect(beta.getByText('ベータ・二番目')).toBeTruthy();
    // alpha is due today; the label reads「今日」.
    expect(getByTestId('due-label-alpha').textContent).toBe('今日');
    expect(getByTestId('due-label-gamma').textContent).toBe('明日');
  });

  it('does not open the detail card while selection mode is on, and clears picks on toggle-off', () => {
    const renderWordDetail = vi.fn((wordId: string) => <div data-testid="detail">詳細: {wordId}</div>);
    const onWeaveWords = vi.fn();
    const { getByTestId, queryByTestId } = renderScreen({ renderWordDetail, onWeaveWords });
    fireEvent.click(getByTestId('wordbook-select-toggle'));
    fireEvent.click(getByTestId('word-row-mitigate'));
    expect(queryByTestId('detail')).toBeNull(); // picked, not opened
    expect(getByTestId('wordbook-selected-count').textContent).toBe('1');
    // Leaving selection mode clears the picks and restores row-click-to-open.
    fireEvent.click(getByTestId('wordbook-select-toggle'));
    expect(queryByTestId('wordbook-selection-footer')).toBeNull();
    fireEvent.click(getByTestId('wordbook-select-toggle'));
    expect(getByTestId('wordbook-selected-count').textContent).toBe('0');
  });
});

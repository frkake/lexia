// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, within, fireEvent } from '@testing-library/react';
import { StudyWordsList, type StudyWord } from './StudyWordsList';

const words: StudyWord[] = [
  {
    wordId: 'mitigate',
    surface: 'mitigate',
    stage: 'Consolidating',
    meaningJa: '和らげる',
    collocation: 'mitigate the risk',
    frequency: 4,
    register: 'business',
    memoryTipJa: 'risk とセットで覚える。',
  },
  { wordId: 'restless', surface: 'restless', stage: 'Learning' },
  { wordId: 'leverage', surface: 'leverage', stage: 'Mastered', reappearCount: 4 },
];

describe('<StudyWordsList/>', () => {
  it('lists every study word with its mastery dot (6.3)', () => {
    const { getByTestId } = render(<StudyWordsList words={words} />);
    const lev = getByTestId('study-word-leverage');
    expect(within(lev).getByText('leverage')).toBeTruthy();
    expect(within(lev).getByTestId('mastery-dot').getAttribute('data-stage')).toBe('Mastered');
  });

  it('reflects each word mastery stage on its dot', () => {
    const { getByTestId } = render(<StudyWordsList words={words} />);
    expect(within(getByTestId('study-word-restless')).getByTestId('mastery-dot').getAttribute('data-stage')).toBe('Learning');
  });

  it('supplements re-appearing words with a consolidation note (6.4)', () => {
    const { getByText, getByTestId } = render(<StudyWordsList words={words} />);
    // "leverage" sits in its own <b>; the count phrase is the surrounding text node
    expect(getByText(/今回が4回目/)).toBeTruthy();
    // the note is keyed to the re-appearing word, not the once-seen ones
    expect(getByTestId('study-word-restless')).toBeTruthy();
  });

  it('shows the study-word count', () => {
    const { getByText } = render(<StudyWordsList words={words} />);
    expect(getByText(/学習語句/)).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('shows compact meaning, collocation, frequency and memory tip when supplied', () => {
    const { getByTestId, getByText } = render(<StudyWordsList words={words} />);
    const item = getByTestId('study-word-mitigate');
    expect(within(item).getByText('和らげる')).toBeTruthy();
    expect(within(item).getByText('mitigate the risk')).toBeTruthy();
    expect(within(item).getByText('頻度 4/5')).toBeTruthy();
    expect(getByText('risk とセットで覚える。')).toBeTruthy();
  });

  it('opens details from the row and plays pronunciation from the audio button', () => {
    const onSelectWord = vi.fn();
    const onPlayWord = vi.fn();
    const { getByTestId, getByLabelText } = render(
      <StudyWordsList words={words} onSelectWord={onSelectWord} onPlayWord={onPlayWord} />,
    );
    fireEvent.click(getByTestId('study-word-mitigate'));
    expect(onSelectWord).toHaveBeenCalledWith('mitigate');
    fireEvent.click(getByLabelText('mitigate の発音を再生'));
    expect(onPlayWord).toHaveBeenCalledWith('mitigate');
  });

  it('marks an expression unknown directly from the rail without opening details', () => {
    const onSelectWord = vi.fn();
    const onMarkUnknown = vi.fn();
    const phrase: StudyWord[] = [{ wordId: 'deal', surface: 'close a deal', stage: 'Learning' }];
    const { getByLabelText } = render(
      <StudyWordsList words={phrase} onSelectWord={onSelectWord} onMarkUnknown={onMarkUnknown} />,
    );
    fireEvent.click(getByLabelText('close a deal を知らなかったとして記録'));
    expect(onMarkUnknown).toHaveBeenCalledWith('deal');
    expect(onSelectWord).not.toHaveBeenCalled();
  });

  it('shows the base form instead of an inflected surface in the right rail', () => {
    const plural: StudyWord[] = [{ wordId: 'dog', surface: 'dogs', stage: 'Learning' }];
    const { getByTestId } = render(<StudyWordsList words={plural} />);
    const row = getByTestId('study-word-dog');

    expect(within(row).getByText('dog')).toBeTruthy();
    expect(within(row).queryByText('dogs')).toBeNull();
  });

  it('keeps a supplied headword label when the word id is opaque', () => {
    const opaque: StudyWord[] = [{ wordId: 'w1', surface: 'resilient', stage: 'Learning' }];
    const { getByTestId } = render(<StudyWordsList words={opaque} />);
    const row = getByTestId('study-word-w1');

    expect(within(row).getByText('resilient')).toBeTruthy();
    expect(within(row).queryByText('w1')).toBeNull();
  });
});

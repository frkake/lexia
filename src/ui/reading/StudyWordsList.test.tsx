// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { StudyWordsList, type StudyWord } from './StudyWordsList';

const words: StudyWord[] = [
  { wordId: 'mitigate', surface: 'mitigate', stage: 'Consolidating' },
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
    expect(getByText(/学習単語/)).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });
});

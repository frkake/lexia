import { describe, it, expect } from 'vitest';
import { studyWordLabel, type StudyWord } from './StudyWordsList';

// The presentational <StudyWordsList/> component was dead code (superseded by ReadingGuideRail)
// and was removed in F-9. Only the shared `studyWordLabel` / `StudyWord` remain here.
describe('studyWordLabel', () => {
  it('prefers the base-form lemma over a simple inflected surface', () => {
    expect(studyWordLabel({ wordId: 'dog', surface: 'dogs' })).toBe('dog');
    expect(studyWordLabel({ wordId: 'try', surface: 'tries' })).toBe('try');
    expect(studyWordLabel({ wordId: 'box', surface: 'boxes' })).toBe('box');
  });

  it('keeps the supplied surface when the word id is opaque or a multi-word expression', () => {
    const opaque: Pick<StudyWord, 'wordId' | 'surface'> = { wordId: 'w1', surface: 'resilient' };
    expect(studyWordLabel(opaque)).toBe('resilient');
    expect(studyWordLabel({ wordId: 'deal', surface: 'close a deal' })).toBe('close a deal');
  });

  it('falls back to the lemma when the surface is empty', () => {
    expect(studyWordLabel({ wordId: 'mitigate', surface: '   ' })).toBe('mitigate');
  });

  it('keeps the surface when it already matches the lemma', () => {
    expect(studyWordLabel({ wordId: 'restless', surface: 'restless' })).toBe('restless');
  });
});

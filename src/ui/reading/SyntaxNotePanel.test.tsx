// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SyntaxNotePanel } from './SyntaxNotePanel';
import type { SentenceSyntaxNote } from '../../types/domain';

const note: SentenceSyntaxNote = {
  sentenceIndex: 0,
  patternNameJa: '倒置（否定副詞句＋助動詞前置）',
  structureJa: '否定の No sooner が文頭に出て倒置が起きる。',
  readingJa: 'No sooner had the meeting started → 会議が始まるやいなや',
  chunks: [
    { tokenStart: 0, tokenEnd: 2, roleJa: '否定副詞句' },
    { tokenStart: 2, tokenEnd: 6, roleJa: '主節（倒置）' },
  ],
};

const tokens = ['No', 'sooner', 'had', 'the', 'meeting', 'started', 'than', 'the', 'alarm', 'rang', '.'];

describe('<SyntaxNotePanel/> (C-4)', () => {
  it('shows the construction label, structure and decoding order', () => {
    const { getByTestId } = render(<SyntaxNotePanel note={note} tokens={tokens} />);
    const panel = getByTestId('syntax-note-0');
    expect(panel.textContent).toContain('倒置（否定副詞句＋助動詞前置）');
    expect(panel.textContent).toContain('文頭に出て倒置');
    expect(panel.textContent).toContain('会議が始まるやいなや');
  });

  it('renders each chunk with its surface text and grammatical role label', () => {
    const { getByTestId } = render(<SyntaxNotePanel note={note} tokens={tokens} />);
    const panel = getByTestId('syntax-note-0');
    expect(panel.textContent).toContain('No sooner'); // chunk 0 surface
    expect(panel.textContent).toContain('否定副詞句'); // chunk 0 role
    expect(panel.textContent).toContain('had the meeting started'); // chunk 1 surface
    expect(panel.textContent).toContain('主節（倒置）'); // chunk 1 role
  });

  it('omits empty structure / reading / chunks without crashing (partial note)', () => {
    const bare: SentenceSyntaxNote = { sentenceIndex: 1, patternNameJa: '分詞構文', structureJa: '', readingJa: '', chunks: [] };
    const { getByTestId } = render(<SyntaxNotePanel note={bare} tokens={tokens} />);
    expect(getByTestId('syntax-note-1').textContent).toContain('分詞構文');
  });
});

/**
 * L4 — SyntaxNotePanel: the expandable「構文」reading aid for a hard sentence (C-4). Given one
 * SentenceSyntaxNote it shows the construction's Japanese label, how the sentence is built (and why
 * it misreads), the natural decoding order as an arrow chain, and each meaning chunk's surface text
 * with a purple-underlined grammatical role. Rendered under the sentence's English cell in the grid
 * layout when the learner opens the「構文」toggle.
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { SentenceSyntaxNote } from '../../types/domain';

/** Canonical surface of a chunk's half-open token range (joined like the body text). */
function chunkSurface(tokens: string[], tokenStart: number, tokenEnd: number): string {
  return tokenizer.renderText({ tokens: tokens.slice(tokenStart, tokenEnd), translationJa: '' }).trim();
}

export interface SyntaxNotePanelProps {
  note: SentenceSyntaxNote;
  /** The sentence's own tokens (string surfaces), used to render each chunk's text. */
  tokens: string[];
}

export function SyntaxNotePanel({ note, tokens }: SyntaxNotePanelProps) {
  return (
    <div data-testid={`syntax-note-${note.sentenceIndex}`} style={panelStyle}>
      <div style={patternRowStyle}>
        <span style={patternBadgeStyle}>構文</span>
        <span style={patternNameStyle}>{note.patternNameJa}</span>
      </div>
      {note.structureJa ? <div style={structureStyle}>{note.structureJa}</div> : null}
      {note.readingJa ? (
        <div style={readingRowStyle}>
          <span style={readingLabelStyle}>読み下し</span>
          <span style={readingTextStyle}>{note.readingJa}</span>
        </div>
      ) : null}
      {note.chunks.length > 0 ? (
        <ul style={chunkListStyle}>
          {note.chunks.map((chunk, i) => (
            <li key={i} style={chunkRowStyle}>
              <span style={chunkSurfaceStyle}>{chunkSurface(tokens, chunk.tokenStart, chunk.tokenEnd)}</span>
              <span style={chunkRoleStyle}>{chunk.roleJa}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const panelStyle: CSSProperties = {
  marginTop: 8,
  padding: '10px 12px',
  background: '#F7F4FC',
  border: `1px solid #E3DAF2`,
  borderRadius: radius.card,
};

const patternRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const patternBadgeStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: '#fff',
  background: colors.syntax,
  borderRadius: 4,
  padding: '2px 7px',
};

const patternNameStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 13,
  fontWeight: 700,
  color: colors.syntaxDeep,
  overflowWrap: 'anywhere',
};

const structureStyle: CSSProperties = {
  marginTop: 8,
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: colors.body,
};

const readingRowStyle: CSSProperties = {
  marginTop: 9,
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
};

const readingLabelStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 10.5,
  fontWeight: 700,
  color: colors.syntaxDeep,
};

const readingTextStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: colors.inkSoft,
  overflowWrap: 'anywhere',
};

const chunkListStyle: CSSProperties = {
  marginTop: 10,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const chunkRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '2px 8px',
};

const chunkSurfaceStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 13,
  color: colors.ink,
  textDecoration: `underline solid ${colors.syntax}`,
  textDecorationThickness: '1.5px',
  textUnderlineOffset: '3px',
  overflowWrap: 'anywhere',
};

const chunkRoleStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  fontWeight: 600,
  color: colors.syntaxDeep,
};

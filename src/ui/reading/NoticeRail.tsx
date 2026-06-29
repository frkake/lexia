/**
 * L4 — NoticeRail (design.md Reading right rail, 6.1/6.2). Lists each NoticeCue with its
 * circled number, category chip, the target expression (rebuilt from the passage tokens in
 * the cue's span) and the Japanese explanation. Chip + number colors come from noticeStyle.
 */

import { noticeStyle, colors, fonts } from '../theme/tokens';
import type { IndexedPassage, NoticeCue, SpanRef } from '../../types/domain';

/** Rebuild the surface expression a cue points at from the passage tokens. */
function expressionFor(passage: IndexedPassage, span: SpanRef): string {
  const sentence = passage.sentences[span.sentenceIndex];
  if (!sentence) return '';
  return sentence.tokens
    .slice(span.tokenStart, span.tokenEnd)
    .map((t) => t.text)
    .join(' ');
}

function NoticeItem({ passage, cue }: { passage: IndexedPassage; cue: NoticeCue }) {
  const style = noticeStyle(cue.category);
  return (
    <div
      data-testid={`notice-item-${cue.index}`}
      style={{ display: 'flex', gap: 11, padding: '14px 0', borderBottom: `1px solid ${colors.dividerRow}` }}
    >
      <span
        style={{
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 19,
          height: 19,
          borderRadius: '50%',
          background: style.numberColor,
          color: '#fff',
          fontFamily: fonts.num,
          fontSize: 11,
          fontWeight: 700,
          marginTop: 1,
        }}
      >
        {cue.index}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span
            style={{
              fontFamily: fonts.ui,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.03em',
              color: style.color,
              background: style.bg,
              borderRadius: 4,
              padding: '2px 7px',
            }}
          >
            {style.label}
          </span>
          <span style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>
            {expressionFor(passage, cue.span)}
          </span>
        </div>
        <div style={{ fontFamily: fonts.bodyJp, fontSize: 12.5, lineHeight: 1.65, color: colors.inkSoft }}>
          {cue.explanationJa}
        </div>
      </div>
    </div>
  );
}

export function NoticeRail({ passage }: { passage: IndexedPassage }) {
  const cues = [...passage.source.noticeCues].sort((a, b) => a.index - b.index);
  return (
    <div>
      <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink, marginBottom: 4 }}>
        この文章で気づきたいこと
      </div>
      <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 16 }}>
        Notice — 意味だけでは見えない手がかり
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {cues.map((cue) => (
          <NoticeItem key={cue.index} passage={passage} cue={cue} />
        ))}
      </div>
    </div>
  );
}

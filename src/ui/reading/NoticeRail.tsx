/**
 * L4 — NoticeRail (design.md Reading right rail, 6.1/6.2). Lists each NoticeCue with its
 * circled number, category chip, the target expression (rebuilt from the passage tokens in
 * the cue's span) and the Japanese explanation. Chip + number colors come from noticeStyle.
 *
 * Spotlight Link (readingUiStore): each item is the rail-side handle of the cue↔span pair.
 * Hover/focus previews the cue (its prose span lights, its badge pulses); click pins it and
 * keeps the existing jump-to-badge scroll. The active item shows a category left-accent +
 * faint background and exposes aria-current, mirroring the lit prose span.
 */

import { noticeStyle, colors, fonts } from '../theme/tokens';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type { IndexedPassage, NoticeCue, SpanRef } from '../../types/domain';

/**
 * Rebuild the surface expression a cue points at from the passage tokens, using the SAME canonical
 * spacing as the body text (PassageRenderer) and the validator — so clitics/punctuation/hyphens
 * ("doesn't", not "does n't") render identically and the rail expression matches the in-text badge.
 */
function expressionFor(passage: IndexedPassage, span: SpanRef): string {
  const sentence = passage.sentences[span.sentenceIndex];
  if (!sentence) return '';
  const tokens = sentence.tokens.slice(span.tokenStart, span.tokenEnd).map((t) => t.text);
  return tokenizer.renderText({ tokens, translationJa: '' }).trim();
}

/** Scroll the body to a cue's in-text badge (PassageRenderer tags each badge with a matching id). */
function jumpToBadge(cueIndex: number): void {
  if (typeof document === 'undefined') return;
  document.getElementById(`notice-badge-${cueIndex}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function NoticeItem({ passage, cue, active }: { passage: IndexedPassage; cue: NoticeCue; active: boolean }) {
  const style = noticeStyle(cue.category);
  const setHover = readingUiStore.getState().setHover;
  const activate = (): void => {
    readingUiStore.getState().setPinned(cue.index);
    jumpToBadge(cue.index);
  };
  return (
    <div
      id={`notice-item-${cue.index}`}
      data-testid={`notice-item-${cue.index}`}
      data-cue-index={cue.index}
      role="button"
      tabIndex={0}
      aria-controls={`notice-badge-${cue.index}`}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => setHover(cue.index)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(cue.index)}
      onBlur={() => setHover(null)}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      title="本文の該当箇所へ移動"
      style={{
        display: 'flex',
        gap: 11,
        padding: '14px 0',
        borderBottom: `1px solid ${colors.dividerRow}`,
        cursor: 'pointer',
        // Active: a category left-accent (inset shadow, so it adds NO layout and the row stays
        // pixel-identical at rest) + a faint chip background, mirroring the lit prose span.
        boxShadow: active ? `inset 3px 0 0 ${style.numberColor}` : undefined,
        background: active ? style.bg : undefined,
        transition: 'background .12s, box-shadow .12s',
      }}
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
  const activeCueIndex = useEffectiveCue();
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
          <NoticeItem key={cue.index} passage={passage} cue={cue} active={cue.index === activeCueIndex} />
        ))}
      </div>
    </div>
  );
}

/**
 * L4 — AnnotatedSpan: the inline passage annotation primitive (design.md
 * "状態別注釈エンコード", 4.2/4.3). It maps a token-span to its visual encoding —
 * the three mastery-density underlines, the brand-new keyword chip, and collocation
 * chips — and emphasizes the TTS follow-along token in primary italic when `active`.
 * Selectable spans become keyboard-operable buttons that drive the WordDetailCard.
 */

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { annotationEncoding, colors, fonts, radius } from '../theme/tokens';

/** Annotation variants: the three densities plus the keyword/collocation chips. */
export type AnnotationKind = 'new' | 'review' | 'known' | 'keyword' | 'collocation';

/** Resolve the inline style for an annotation kind, with the active TTS modifier. */
export function annotationStyle(kind: AnnotationKind, active = false): CSSProperties {
  let base: CSSProperties;
  if (kind === 'keyword') {
    base = {
      background: colors.primary,
      color: '#fff',
      borderRadius: 3,
      padding: '0 4px',
    };
  } else if (kind === 'collocation') {
    base = {
      background: colors.surfaceCollocation,
      borderRadius: 3,
      padding: '1px 3px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    };
  } else {
    const enc = annotationEncoding[kind];
    base = { borderBottom: `1.5px ${enc.underlineStyle} ${enc.color}` };
  }
  if (active) {
    return { ...base, color: colors.primary, fontStyle: 'italic', fontFamily: fonts.serif };
  }
  return base;
}

export interface AnnotatedSpanProps {
  children: ReactNode;
  kind: AnnotationKind;
  /** True while this token is the one the TTS playhead is reading. */
  active?: boolean;
  /** Optional guide/rail anchor id measured by useLineAnchors. */
  lineAnchorId?: string;
  /** When supplied, the span becomes a selectable button (opens word detail). */
  onSelect?: () => void;
  title?: string;
}

export function AnnotatedSpan({ children, kind, active = false, lineAnchorId, onSelect, title }: AnnotatedSpanProps) {
  const style: CSSProperties = {
    ...annotationStyle(kind, active),
    cursor: onSelect ? 'pointer' : undefined,
    borderRadius: kind === 'collocation' || kind === 'keyword' ? radius.chip - 3 : undefined,
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (!onSelect) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <span
      data-kind={kind}
      data-active={String(active)}
      data-line-anchor={lineAnchorId}
      title={title}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      {...(onSelect ? { role: 'button', tabIndex: 0 } : {})}
      style={style}
    >
      {children}
    </span>
  );
}

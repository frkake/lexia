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

import { useState } from 'react';
import { noticeStyle, colors, fonts, radius } from '../theme/tokens';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type { LineAnchor } from './useLineAnchors';
import type { IndexedPassage, NoticeCue, SpanRef } from '../../types/domain';

/** A rail item placed at an absolute Y (after collision avoidance). */
export interface PlacedRailItem {
  cueIndex: number;
  top: number;
}

/**
 * Resolve the absolute Y of each rail item from its appearance-line anchor (2.1), pushing items
 * that would overlap downward so every item stays readable (2.3). Anchors are sorted by line first,
 * so the original cue order is preserved; each item is placed at max(its anchor, prev bottom),
 * guaranteeing a gap of at least `itemHeight` between consecutive items.
 */
export function placeRailItems(anchors: LineAnchor[], itemHeight: number): PlacedRailItem[] {
  const sorted = [...anchors]
    .map((a) => ({ cueIndex: a.cueIndex ?? Number(a.itemId), top: a.top }))
    .filter((a): a is PlacedRailItem => Number.isFinite(a.cueIndex))
    .sort((a, b) => a.top - b.top || a.cueIndex - b.cueIndex);
  const placed: PlacedRailItem[] = [];
  let prevBottom = -Infinity;
  for (const a of sorted) {
    const top = Math.max(a.top, prevBottom);
    placed.push({ cueIndex: a.cueIndex, top });
    prevBottom = top + itemHeight;
  }
  return placed;
}

/** Approximate rendered height of a rail item (number badge + chip + action + 2 lines of JA + padding). */
const RAIL_ITEM_HEIGHT = 94;

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

function NoticeItem({
  passage,
  cue,
  active,
  placedTop,
  onMarkUnknown,
  markingUnknownId,
}: {
  passage: IndexedPassage;
  cue: NoticeCue;
  active: boolean;
  /** When set, the item is absolutely positioned at this container-relative Y (line-aligned mode). */
  placedTop?: number;
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
  markingUnknownId?: string | null;
}) {
  const style = noticeStyle(cue.category);
  const expression = expressionFor(passage, cue.span);
  const markTargetId = cue.wordId ?? expression;
  const isUnknownPending = markingUnknownId !== null && markingUnknownId !== undefined;
  const isMarkingUnknown = markingUnknownId === markTargetId;
  const setHover = readingUiStore.getState().setHover;
  const activate = (): void => {
    readingUiStore.getState().setPinned(cue.index);
    jumpToBadge(cue.index);
  };
  const aligned = placedTop !== undefined;
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
        // Line-aligned mode: absolutely position the item at its appearance line (2.1). The full
        // width is held by the relatively-positioned rail container below.
        ...(aligned ? { position: 'absolute', top: placedTop, left: 0, right: 0 } : null),
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
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
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
              {expression}
            </span>
          </div>
          {onMarkUnknown ? (
            <button
              type="button"
              aria-label={`${expression} を知らなかったとして記録`}
              data-testid={`notice-mark-unknown-${cue.index}`}
              disabled={isUnknownPending}
              aria-busy={isMarkingUnknown}
              onClick={(event) => {
                event.stopPropagation();
                void onMarkUnknown(markTargetId);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              style={noticeUnknownButtonStyle(isUnknownPending)}
            >
              {isMarkingUnknown ? '記録中…' : '知らなかった'}
            </button>
          ) : null}
        </div>
        <div style={{ fontFamily: fonts.bodyJp, fontSize: 12.5, lineHeight: 1.65, color: colors.inkSoft }}>
          {cue.explanationJa}
        </div>
      </div>
    </div>
  );
}

export interface NoticeRailProps {
  passage: IndexedPassage;
  /**
   * Per-cue appearance-line anchors from useLineAnchors. When supplied, each item is absolutely
   * positioned at its line (2.1) with collision avoidance (2.3); when absent, the rail falls back
   * to flat flow order (narrow layout / measurement disabled).
   */
  anchors?: LineAnchor[];
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
}

export function NoticeRail({ passage, anchors, onMarkUnknown }: NoticeRailProps) {
  const [markingUnknownId, setMarkingUnknownId] = useState<string | null>(null);
  const cues = [...passage.source.noticeCues].sort((a, b) => a.index - b.index);
  const activeCueIndex = useEffectiveCue();
  const aligned = anchors !== undefined && anchors.length > 0;
  const placed = aligned ? placeRailItems(anchors, RAIL_ITEM_HEIGHT) : [];
  const topByCue = new Map(placed.map((p) => [p.cueIndex, p.top] as const));
  // The absolutely-positioned items need a tall enough relatively-positioned container.
  const containerHeight = aligned
    ? placed.reduce((max, p) => Math.max(max, p.top + RAIL_ITEM_HEIGHT), 0)
    : undefined;
  const markUnknown = async (targetId: string): Promise<void> => {
    if (!onMarkUnknown || markingUnknownId) return;
    setMarkingUnknownId(targetId);
    try {
      await onMarkUnknown(targetId);
    } catch {
      // Keep the rail usable if persistence fails; this mirrors the word-detail card behavior.
    } finally {
      setMarkingUnknownId(null);
    }
  };

  return (
    <div>
      <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink, marginBottom: 4 }}>
        この文章で気づきたいこと
      </div>
      <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 16 }}>
        Notice — 意味だけでは見えない手がかり
      </div>
      <div
        style={
          aligned
            ? { position: 'relative', height: containerHeight }
            : { display: 'flex', flexDirection: 'column' }
        }
      >
        {cues.map((cue) => (
          <NoticeItem
            key={cue.index}
            passage={passage}
            cue={cue}
            active={cue.index === activeCueIndex}
            placedTop={aligned ? topByCue.get(cue.index) : undefined}
            onMarkUnknown={onMarkUnknown ? markUnknown : undefined}
            markingUnknownId={markingUnknownId}
          />
        ))}
      </div>
    </div>
  );
}

const noticeUnknownButtonStyle = (disabled: boolean) => ({
  flex: 'none',
  minWidth: 86,
  height: 28,
  borderRadius: radius.control,
  border: `1px solid ${colors.terracottaBorder}`,
  background: disabled ? colors.surfaceSubtle : colors.surfaceCard,
  color: colors.terracottaDeep,
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  cursor: disabled ? 'wait' : 'pointer',
  opacity: disabled ? 0.72 : 1,
} as const);

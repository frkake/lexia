/**
 * L4 — PassageRenderer: renders an IndexedPassage as annotated prose (design.md
 * "ReadingScreen", 4.2/4.3/4.6). Target words carry their mastery-density underline,
 * collocations are tinted chips with the target nested inside, and each NoticeCue gets
 * a circled number badge. Selecting a target word drives the WordDetailCard; the active
 * TTS token is emphasized. Spacing is reconstructed from the tokenizer's char offsets so
 * the rendered text is byte-for-byte the string the TTS engine read. Per-sentence
 * translations are injected by the caller via `renderAfterSentence` (SentenceTranslation).
 *
 * Spotlight Link (readingUiStore): every cue's FULL token span is wrapped in transparent
 * `cue-seg` spans (data-cue-index) so the whole extent — not just the trailing badge — can
 * light up when that cue is the effective active cue. The badge is the prose-side handle:
 * hover/focus previews the cue (both columns light), click pins it and scrolls the rail
 * item into view. Highlight lives on collision-free channels — a faint category FILL on
 * plain/underline tokens, an inset RING on tokens that already own a background (collocation
 * chip) — so it never competes with mastery underlines or the chip tint, and at rest the
 * wrappers render no ink.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { AnnotatedSpan, type AnnotationKind } from '../shared/AnnotatedSpan';
import { InlineNoticePopover } from './InlineNoticePopover';
import { SyntaxNotePanel } from './SyntaxNotePanel';
import { noticeStyle, cueHighlight, colors, fonts } from '../theme/tokens';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type {
  IndexedPassage,
  IndexedSentence,
  IndexedToken,
  TargetSpan,
  CollocationSpan,
  ExpressionSpan,
  NoticeCue,
  TokenId,
} from '../../types/domain';

const BASE_PROSE_PX = 19;

/**
 * Expression highlight (B-1 / B-2): idioms / phrasal verbs / set phrases the model self-reported in
 * `expressionSpans` get a dashed underline in the idiom-family terracotta hue — a single learnable
 * "formulaic language" marker, deliberately distinct from the mastery underlines (solid/dotted blue,
 * grey) and the collocation tint (blue fill), so all three encodings stay readable when they overlap.
 * The underline is a text-decoration channel (unused by any other leaf), so it layers additively over
 * the existing target/collocation/cue rendering without touching that logic.
 */
const expressionSegStyle: CSSProperties = {
  textDecoration: `underline dashed ${colors.terracotta}`,
  textDecorationThickness: '1.5px',
  textUnderlineOffset: '4px',
};

/** F-8②: paragraph block spacing for the legacy prose layout. */
const proseParagraphStyle: CSSProperties = { margin: '0 0 1em' };

/** C-4: the small purple「構文」toggle shown under a hard sentence in the grid layout. */
const syntaxToggleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: colors.syntaxDeep,
  background: '#EFE9F7',
  border: `1px solid #E3DAF2`,
  borderRadius: 5,
  padding: '2px 8px',
  cursor: 'pointer',
};

/** Reading layout: legacy flowing prose, or the sentence-unit 2-column grid (Requirement 3.1). */
export type PassageLayout = 'prose' | 'grid';

export interface PassageRendererProps {
  passage: IndexedPassage;
  fontScale?: number;
  /** Token currently under the TTS playhead (emphasized when within a target). */
  activeTokenId?: TokenId | null;
  onSelectWord?: (wordId: string) => void;
  /**
   * Block content to inject after a sentence in PROSE layout (per-sentence translation).
   * Preserved for the legacy layout; the grid layout uses `renderAside` (right cell) instead.
   */
  renderAfterSentence?: (sentenceIndex: number) => ReactNode;
  /** Right-cell content for the GRID layout: the sentence's Japanese translation (3.1). */
  renderAside?: (sentenceIndex: number) => ReactNode;
  /**
   * GRID layout only (F-8①): when false (translation off), the right translation column is dropped
   * and the English text spans the full container width as a single column. Defaults to true.
   */
  asideEnabled?: boolean;
  /**
   * D-1 mobile fallback: on a narrow viewport the rail is stacked far below the prose, so tapping an
   * in-text notice badge opens an inline popover under the badge (no scroll) instead of scrolling to
   * the rail item. Defaults to false (wide layout scrolls to the rail as before).
   */
  isNarrow?: boolean;
  /** 'prose' (default, legacy) keeps flowing prose; 'grid' is the new sentence-unit 2-column layout. */
  layout?: PassageLayout;
  /** Lowercase wordId -> unified guide item anchor id. Only the first target occurrence is anchored. */
  guideAnchorIdByWordKey?: Record<string, string>;
  /** Cue index -> unified guide item DOM id. Absorbed cues point at their study-word card. */
  guideTargetIdByCueIndex?: Record<number, string>;
  /** Cue index -> unified guide number shown in in-text notice badges. */
  guideNumberByCueIndex?: Record<number, number>;
  /** Lowercase wordId -> unified guide number shown at the first study-word occurrence. */
  guideNumberByWordKey?: Record<string, number>;
  /** Cue indices whose notice badge is replaced by the study-word badge. */
  absorbedCueIndexByIndex?: Record<number, true>;
}

function targetAnchorKey(span: TargetSpan): string {
  return `${span.wordId.trim().toLowerCase()}:${span.sentenceIndex}:${span.tokenStart}:${span.tokenEnd}`;
}

export function PassageRenderer({
  passage,
  fontScale = 1,
  activeTokenId = null,
  onSelectWord,
  renderAfterSentence,
  renderAside,
  asideEnabled = true,
  isNarrow = false,
  layout = 'prose',
  guideAnchorIdByWordKey,
  guideTargetIdByCueIndex,
  guideNumberByCueIndex,
  guideNumberByWordKey,
  absorbedCueIndexByIndex,
}: PassageRendererProps) {
  const { source } = passage;
  // The single cue currently lit across both columns (hover preview wins over the pin).
  const activeCueIndex = useEffectiveCue();
  // Roving tabindex over the in-text badges: one tab stop, arrows move between them.
  const [rovingPos, setRovingPos] = useState(0);
  // D-1 mobile fallback: which cue's inline popover is open (narrow layout only). Reset per passage.
  const [popoverCueIndex, setPopoverCueIndex] = useState<number | null>(null);
  useEffect(() => setPopoverCueIndex(null), [passage.passageId]);
  // C-4: sentence-level syntax notes keyed by sentence index, and which are expanded (grid layout).
  const syntaxNoteBySentence = new Map((source.syntaxNotes ?? []).map((n) => [n.sentenceIndex, n] as const));
  const [expandedSyntaxNotes, setExpandedSyntaxNotes] = useState<Set<number>>(() => new Set());
  useEffect(() => setExpandedSyntaxNotes(new Set()), [passage.passageId]);
  const toggleSyntaxNote = (sentenceIndex: number): void =>
    setExpandedSyntaxNotes((prev) => {
      const next = new Set(prev);
      if (next.has(sentenceIndex)) next.delete(sentenceIndex);
      else next.add(sentenceIndex);
      return next;
    });

  const proseStyle: CSSProperties = {
    fontFamily: fonts.serifJp,
    fontSize: Math.round(BASE_PROSE_PX * fontScale * 100) / 100,
    lineHeight: 1.95,
    color: colors.body,
    letterSpacing: '.003em',
  };

  const visibleNoticeCues = source.noticeCues.filter((c) => !absorbedCueIndexByIndex?.[c.index]);
  const orderedCueIndices = [...visibleNoticeCues].map((c) => c.index).sort((a, b) => a - b);
  const badgePos = new Map(orderedCueIndices.map((idx, pos) => [idx, pos] as const));
  const categoryByCue = new Map(source.noticeCues.map((c) => [c.index, c.category] as const));
  const rovingClamped = Math.min(rovingPos, Math.max(0, orderedCueIndices.length - 1));
  const firstTargetAnchorBySpan = new Map<string, string>();
  if (guideAnchorIdByWordKey) {
    const seen = new Set<string>();
    const sortedTargets = [...source.targetSpans].sort(
      (a, b) => a.sentenceIndex - b.sentenceIndex || a.tokenStart - b.tokenStart || a.tokenEnd - b.tokenEnd,
    );
    for (const span of sortedTargets) {
      const key = span.wordId.trim().toLowerCase();
      const anchor = guideAnchorIdByWordKey[key];
      if (!anchor || seen.has(key)) continue;
      seen.add(key);
      firstTargetAnchorBySpan.set(targetAnchorKey(span), anchor);
    }
  }

  const densityKind = (span: TargetSpan): AnnotationKind => span.masteryDensity;
  const lineAnchorForTarget = (span: TargetSpan): string | undefined => firstTargetAnchorBySpan.get(targetAnchorKey(span));
  const speakerLabelFor = (sentenceIndex: number): string | null => {
    const speakerId = source.sentences[sentenceIndex]?.speakerId;
    if (!speakerId) return null;
    return source.meta.listeningScene?.speakers.find((s) => s.speakerId === speakerId)?.label ?? speakerId;
  };

  const isActive = (tokens: IndexedToken[], start: number, end: number): boolean =>
    activeTokenId != null && tokens.slice(start, end).some((t) => t.tokenId === activeTokenId);

  /**
   * Inline style for a cue segment. Two regimes:
   *   - PROSE (legacy): ink only when the cue is the active one (fill on free tokens, ring on chips).
   *   - GRID (3.2): on a FREE token the category cue is always visible as a faint fill, and focusing
   *     it escalates to a deep category ring. INSIDE a collocation chip, however, the chip's own tint
   *     + number badge already mark the expression, so we draw NO per-token ring at rest (a ring per
   *     word boxes every token of e.g. "strike a bargain" and clutters the chip); the ring appears
   *     ONLY on focus. So all annotations stay legible at rest and the focused one is distinguishable.
   * The category color comes from the active cue when focused, else the first cue listed on the seg.
   */
  function segStyle(ids: number[], withinChip: boolean): CSSProperties | undefined {
    const isActive = activeCueIndex != null && ids.includes(activeCueIndex);

    if (layout !== 'grid') {
      if (!isActive) return undefined;
      const category = categoryByCue.get(activeCueIndex);
      if (!category) return undefined;
      const hl = cueHighlight(category);
      return withinChip
        ? { boxShadow: `inset 0 0 0 1.5px ${hl.ring}`, borderRadius: 3 }
        : { background: hl.fill, borderRadius: 3 };
    }

    // Grid: always-on, focus escalates.
    const baseCueIndex = isActive ? activeCueIndex : ids[0];
    if (baseCueIndex == null) return undefined;
    const category = categoryByCue.get(baseCueIndex);
    if (!category) return undefined;
    const hl = cueHighlight(category);

    if (withinChip) {
      // Chip tint + badge already mark the expression at rest, so draw the inset ring ONLY on focus
      // — a per-word ring at rest boxes every token of the collocation and clutters the chip.
      if (!isActive) return undefined;
      return { boxShadow: `inset 0 0 0 2px ${hl.ring}`, borderRadius: 3 };
    }
    // Free token: always-on faint fill; focus adds an outer deep category ring over the fill.
    return {
      background: hl.fill,
      borderRadius: 3,
      ...(isActive ? { boxShadow: `0 0 0 1.5px ${hl.ring}` } : null),
    };
  }

  /** Wrap a leaf in a decorative cue segment so its cue can light the full extent later. */
  function wrapCue(node: ReactNode, ids: number[], withinChip: boolean, key: string): ReactNode {
    if (ids.length === 0) return node;
    return (
      <span key={key} className="cue-seg" data-cue-index={ids.join(' ')} style={segStyle(ids, withinChip)}>
        {node}
      </span>
    );
  }

  /** The circled number — also the prose-side handle that drives the shared active cue. */
  function noticeBadge(cue: NoticeCue): ReactNode {
    const active = activeCueIndex === cue.index;
    const ring = cueHighlight(cue.category).ring;
    const pos = badgePos.get(cue.index) ?? 0;
    const displayIndex = guideNumberByCueIndex?.[cue.index] ?? cue.index;

    const pin = (): void => {
      readingUiStore.getState().setPinned(cue.index);
      // Narrow: open/close the inline popover under the badge instead of scrolling to the stacked rail
      // (which would jump the reader far down the page and lose their reading position).
      if (isNarrow) {
        setPopoverCueIndex((prev) => (prev === cue.index ? null : cue.index));
        return;
      }
      if (typeof document !== 'undefined') {
        document
          .getElementById(guideTargetIdByCueIndex?.[cue.index] ?? `notice-item-${cue.index}`)
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }
    };
    const focusBadge = (next: number): void => {
      setRovingPos(next);
      if (typeof document !== 'undefined') {
        document.getElementById(`notice-badge-${orderedCueIndices[next]}`)?.focus?.();
      }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pin();
        return;
      }
      let next: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(orderedCueIndices.length - 1, pos + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, pos - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = orderedCueIndices.length - 1;
      if (next !== null) {
        e.preventDefault();
        focusBadge(next);
      }
    };

    const badge = (
      <span
        key={`badge-${cue.index}`}
        // `id` is the scroll target NoticeRail jumps to; `scrollMarginTop` keeps the badge clear of
        // the sticky mobile header when scrolled into view.
        id={`notice-badge-${cue.index}`}
        data-testid={`notice-badge-${cue.index}`}
        // Line-anchor handle for useLineAnchors: its Y position aligns the matching rail item (2.1).
        data-line-anchor={cue.index}
        className="notice-badge"
        role="button"
        aria-label={`気づき${displayIndex} ${noticeStyle(cue.category).label} — 本文の該当箇所`}
        aria-controls={guideTargetIdByCueIndex?.[cue.index] ?? `notice-item-${cue.index}`}
        tabIndex={pos === rovingClamped ? 0 : -1}
        onMouseEnter={() => readingUiStore.getState().setHover(cue.index)}
        onMouseLeave={() => readingUiStore.getState().setHover(null)}
        onFocus={() => {
          readingUiStore.getState().setHover(cue.index);
          setRovingPos(pos);
        }}
        onBlur={() => readingUiStore.getState().setHover(null)}
        onClick={pin}
        onKeyDown={onKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: noticeStyle(cue.category).numberColor,
          color: '#fff',
          fontFamily: fonts.num,
          fontSize: 9,
          fontWeight: 700,
          verticalAlign: '8px',
          marginLeft: 1,
          lineHeight: 1,
          scrollMarginTop: 90,
          cursor: 'pointer',
          ...(active ? { boxShadow: `0 0 0 2px ${ring}`, transform: 'scale(1.12)' } : null),
        }}
      >
        {displayIndex}
      </span>
    );

    // Wide layout: the bare badge (click scrolls to the rail). Narrow: wrap it in a relative anchor so
    // the inline popover can hang under it without reflowing the surrounding prose.
    if (!isNarrow) return badge;
    return (
      <span key={`badge-wrap-${cue.index}`} style={{ position: 'relative', display: 'inline' }}>
        {badge}
        {popoverCueIndex === cue.index ? (
          <InlineNoticePopover cue={cue} displayIndex={displayIndex} onClose={() => setPopoverCueIndex(null)} />
        ) : null}
      </span>
    );
  }

  function studyWordBadge(span: TargetSpan): ReactNode | null {
    const key = span.wordId.trim().toLowerCase();
    const anchorId = guideAnchorIdByWordKey?.[key];
    const displayIndex = guideNumberByWordKey?.[key];
    if (!anchorId || displayIndex === undefined || lineAnchorForTarget(span) !== anchorId) return null;
    const jumpToGuide = (): void => {
      if (typeof document !== 'undefined') {
        document.getElementById(`guide-item-${anchorId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }
    };
    const jump = (event: MouseEvent<HTMLSpanElement>): void => {
      event.stopPropagation();
      jumpToGuide();
    };
    return (
      <span
        id={`inline-guide-badge-${anchorId}`}
        key={`study-badge-${key}`}
        data-testid={`study-guide-badge-${key}`}
        className="study-guide-badge"
        role="button"
        tabIndex={0}
        aria-label={`学習語句${displayIndex} — 右の学習ガイドへ移動`}
        aria-controls={`guide-item-${anchorId}`}
        onClick={jump}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            jumpToGuide();
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: colors.primary,
          color: '#fff',
          fontFamily: fonts.num,
          fontSize: 9,
          fontWeight: 700,
          verticalAlign: '8px',
          marginLeft: 1,
          lineHeight: 1,
          scrollMarginTop: 90,
          cursor: 'pointer',
        }}
      >
        {displayIndex}
      </span>
    );
  }

  function renderSentence(sentence: IndexedSentence): ReactNode {
    const { sentenceIndex, tokens } = sentence;
    const targets = source.targetSpans.filter((s) => s.sentenceIndex === sentenceIndex);
    const collocations = source.collocationSpans.filter((s) => s.sentenceIndex === sentenceIndex);
    // B-1 / B-2 self-reported idioms / phrasal verbs / set phrases in this sentence, indexed per token.
    const exprByToken = new Map<number, ExpressionSpan>();
    for (const e of (source.expressionSpans ?? []).filter((s) => s.span.sentenceIndex === sentenceIndex)) {
      for (let t = e.span.tokenStart; t < e.span.tokenEnd; t += 1) exprByToken.set(t, e);
    }
    const exprAt = (i: number): ExpressionSpan | undefined => exprByToken.get(i);
    const exprAtGap = (prevIdx: number, curIdx: number): ExpressionSpan | undefined => {
      const e = exprByToken.get(prevIdx);
      return e && e === exprByToken.get(curIdx) ? e : undefined;
    };
    /** Layer the dashed expression underline over a leaf (or gap) that sits inside an expression. */
    const decorateExpr = (node: ReactNode, e: ExpressionSpan | undefined, key: string): ReactNode => {
      if (!e) return node;
      return (
        <span
          key={key}
          className="expression-seg"
          data-expression-category={e.category}
          title={e.meaningJa || undefined}
          style={expressionSegStyle}
        >
          {node}
        </span>
      );
    };
    const cuesByEnd = new Map<number, NoticeCue[]>();
    const cuesByToken = new Map<number, number[]>();
    const lightToken = (token: number, cueIndex: number): void => {
      const ids = cuesByToken.get(token) ?? [];
      if (!ids.includes(cueIndex)) ids.push(cueIndex);
      cuesByToken.set(token, ids);
    };
    for (const cue of source.noticeCues.filter((c) => c.span.sentenceIndex === sentenceIndex)) {
      const list = cuesByEnd.get(cue.span.tokenEnd) ?? [];
      list.push(cue);
      cuesByEnd.set(cue.span.tokenEnd, list);
      for (let t = cue.span.tokenStart; t < cue.span.tokenEnd; t += 1) lightToken(t, cue.index);
    }
    // C-4: light the extra contiguous parts of a DISCONTINUOUS expression (e.g. the「than」half of
    // "no sooner ... than") under the SAME cue index — no extra badge, so both parts glow as one unit
    // when the cue is active. extraSpans may live in this sentence even if the badge sits elsewhere.
    for (const cue of source.noticeCues) {
      for (const extra of cue.extraSpans ?? []) {
        if (extra.sentenceIndex !== sentenceIndex) continue;
        for (let t = extra.tokenStart; t < extra.tokenEnd; t += 1) lightToken(t, cue.index);
      }
    }
    const cueIdsAt = (i: number): number[] => cuesByToken.get(i) ?? [];
    const cueIdsForRange = (start: number, end: number): number[] => {
      const set = new Set<number>();
      for (let t = start; t < end; t += 1) for (const id of cueIdsAt(t)) set.add(id);
      return [...set];
    };
    const intersect = (a: number[], b: number[]): number[] => a.filter((x) => b.includes(x));

    const targetAt = (i: number): TargetSpan | undefined => targets.find((s) => s.tokenStart === i);
    const collAt = (i: number): CollocationSpan | undefined => collocations.find((s) => s.tokenStart === i);

    const out: ReactNode[] = [];
    let lastCharEnd: number | null = null;

    const surface = (start: number, end: number): string =>
      tokens.slice(start, end).map((t) => t.text).join(' '); // surface only used for word lookup label

    /** A space between two tokens; tagged as a cue segment when both sides share a cue (continuity). */
    const gapNode = (prevIdx: number, curIdx: number, withinChip: boolean, key: string): ReactNode => {
      const ids = intersect(cueIdsAt(prevIdx), cueIdsAt(curIdx));
      const base: ReactNode =
        ids.length === 0 ? (
          ' '
        ) : (
          <span key={key} className="cue-seg" data-cue-index={ids.join(' ')} style={segStyle(ids, withinChip)}>
            {' '}
          </span>
        );
      // Keep the expression underline continuous across the space between two of its tokens.
      return decorateExpr(base, exprAtGap(prevIdx, curIdx), `xgap-${key}`);
    };

    const emitGapBefore = (token: IndexedToken, curIdx: number): void => {
      if (lastCharEnd !== null && token.charStart > lastCharEnd) {
        out.push(gapNode(curIdx - 1, curIdx, false, `gap-${token.tokenId}`));
      }
    };

    /** Inner rendering of a collocation: targets stay annotated, the rest goes italic. */
    function renderInner(start: number, end: number): ReactNode[] {
      const inner: ReactNode[] = [];
      let i = start;
      let innerLast: number | null = null;
      while (i < end) {
        const tok = tokens[i]!;
        // Inside a chip the background channel is taken, so cue segments here use the ring.
        if (innerLast !== null && tok.charStart > innerLast) inner.push(gapNode(i - 1, i, true, `igap-${tok.tokenId}`));
        const t = targetAt(i);
        if (t && t.tokenEnd <= end) {
          inner.push(
            wrapCue(
              decorateExpr(
                <AnnotatedSpan
                  key={tok.tokenId}
                  kind={densityKind(t)}
                  active={isActive(tokens, t.tokenStart, t.tokenEnd)}
                  lineAnchorId={lineAnchorForTarget(t)}
                  onSelect={onSelectWord ? () => onSelectWord(t.wordId) : undefined}
                  title={t.wordId}
                >
                  {t.surface}
                </AnnotatedSpan>,
                exprAt(t.tokenStart),
                `ix-${tok.tokenId}`,
              ),
              cueIdsForRange(t.tokenStart, t.tokenEnd),
              true,
              `iseg-${tok.tokenId}`,
            ),
          );
          const badge = studyWordBadge(t);
          if (badge) inner.push(badge);
          innerLast = tokens[t.tokenEnd - 1]!.charEnd;
          i = t.tokenEnd;
        } else {
          inner.push(
            wrapCue(
              decorateExpr(
                <span key={tok.tokenId} style={{ fontStyle: 'italic' }}>
                  {tok.text}
                </span>,
                exprAt(i),
                `ix-${tok.tokenId}`,
              ),
              cueIdsAt(i),
              true,
              `iseg-${tok.tokenId}`,
            ),
          );
          innerLast = tok.charEnd;
          i += 1;
        }
      }
      return inner;
    }

    // Flush every not-yet-emitted cue whose span ENDS at or before `end`. A cue whose tokenEnd
    // lands strictly inside a target/collocation span (e.g. a connotation cue on the head word of
    // a collocation chip) would otherwise be skipped when the cursor jumps over the span — its
    // badge would vanish from the prose while NoticeRail still lists it. Flushing by "ended by now"
    // surfaces such a badge right after the chip, keeping the in-text marker ↔ rail correspondence.
    const emittedEnds = new Set<number>();
    const emitBadges = (end: number): void => {
      const pending = [...cuesByEnd.keys()].filter((e) => e <= end && !emittedEnds.has(e)).sort((a, b) => a - b);
      for (const e of pending) {
        emittedEnds.add(e);
        for (const cue of cuesByEnd.get(e)!) {
          if (absorbedCueIndexByIndex?.[cue.index]) continue;
          out.push(noticeBadge(cue));
        }
      }
    };

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      const coll = collAt(i);
      if (coll) {
        emitGapBefore(tok, i);
        // The outer chip is intentionally NOT wrapped in a cue-seg: a fill there would extend the
        // #E4EDF8 tint at rest. Cue segments live on the inner leaves (ring, via renderInner).
        out.push(
          <AnnotatedSpan key={`coll-${tok.tokenId}`} kind="collocation">
            {renderInner(coll.tokenStart, coll.tokenEnd)}
          </AnnotatedSpan>,
        );
        lastCharEnd = tokens[coll.tokenEnd - 1]!.charEnd;
        emitBadges(coll.tokenEnd);
        i = coll.tokenEnd;
        continue;
      }
      const target = targetAt(i);
      if (target) {
        emitGapBefore(tok, i);
        out.push(
          wrapCue(
            decorateExpr(
              <AnnotatedSpan
                key={tok.tokenId}
                kind={densityKind(target)}
                active={isActive(tokens, target.tokenStart, target.tokenEnd)}
                lineAnchorId={lineAnchorForTarget(target)}
                onSelect={onSelectWord ? () => onSelectWord(target.wordId) : undefined}
                title={target.wordId}
              >
                {target.surface || surface(target.tokenStart, target.tokenEnd)}
              </AnnotatedSpan>,
              exprAt(target.tokenStart),
              `x-${tok.tokenId}`,
            ),
            cueIdsForRange(target.tokenStart, target.tokenEnd),
            false,
            `seg-${tok.tokenId}`,
          ),
        );
        const badge = studyWordBadge(target);
        if (badge) out.push(badge);
        lastCharEnd = tokens[target.tokenEnd - 1]!.charEnd;
        emitBadges(target.tokenEnd);
        i = target.tokenEnd;
        continue;
      }
      emitGapBefore(tok, i);
      out.push(
        wrapCue(
          decorateExpr(<span key={tok.tokenId}>{tok.text}</span>, exprAt(i), `x-${tok.tokenId}`),
          cueIdsAt(i),
          false,
          `seg-${tok.tokenId}`,
        ),
      );
      lastCharEnd = tok.charEnd;
      emitBadges(i + 1);
      i += 1;
    }

    // Safety net: surface any in-range cue not reached above (e.g. tokenEnd === tokens.length).
    emitBadges(tokens.length);

    const speakerLabel = speakerLabelFor(sentenceIndex);
    return (
      <>
        {speakerLabel ? (
          <span data-testid={`speaker-label-${sentenceIndex}`} style={speakerLabelStyle}>
            {speakerLabel}
          </span>
        ) : null}
        {out}
      </>
    );
  }

  if (layout === 'grid') {
    // Sentence-unit 2-column grid: each sentence is one row, English in the left cell and its
    // Japanese translation injected into the right cell (renderAside). Correspondence is kept by
    // construction — a sentence's translation can only land in its own row's right cell (3.1/3.2).
    return (
      <div data-testid="passage-prose" data-layout="grid" style={{ ...proseStyle, display: 'block' }}>
        {passage.sentences.map((sentence, i) => {
          // F-8②: widen the gap after a row when the next sentence opens a new paragraph. Passages
          // generated before paragraphIndex existed keep the uniform 14px spacing (all undefined).
          const nextSentence = passage.sentences[i + 1];
          const curPara = source.sentences[sentence.sentenceIndex]?.paragraphIndex;
          const nextPara = nextSentence ? source.sentences[nextSentence.sentenceIndex]?.paragraphIndex : undefined;
          const paragraphBreak = curPara !== undefined && nextPara !== undefined && nextPara !== curPara;
          return (
          <div
            key={sentence.sentenceIndex}
            data-testid={`sentence-row-${sentence.sentenceIndex}`}
            data-sentence-index={sentence.sentenceIndex}
            data-paragraph-index={curPara}
            className="sentence-row"
            style={{
              display: 'grid',
              gridTemplateColumns: asideEnabled ? 'minmax(0, 1.6fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
              columnGap: 26,
              alignItems: 'start',
              marginBottom: paragraphBreak ? 28 : 14,
            }}
          >
            <div data-testid={`sentence-en-${sentence.sentenceIndex}`} className="sentence-en" style={{ minWidth: 0 }}>
              {renderSentence(sentence)}
              {(() => {
                // C-4: a「構文」toggle for a hard sentence, revealing its SyntaxNotePanel below the text.
                const note = syntaxNoteBySentence.get(sentence.sentenceIndex);
                if (!note) return null;
                const open = expandedSyntaxNotes.has(sentence.sentenceIndex);
                return (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      data-testid={`syntax-note-toggle-${sentence.sentenceIndex}`}
                      aria-expanded={open}
                      onClick={() => toggleSyntaxNote(sentence.sentenceIndex)}
                      style={syntaxToggleStyle}
                    >
                      構文 {open ? '▾' : '▸'}
                    </button>
                    {open ? (
                      <SyntaxNotePanel note={note} tokens={source.sentences[sentence.sentenceIndex]?.tokens ?? []} />
                    ) : null}
                  </div>
                );
              })()}
            </div>
            {asideEnabled ? (
              <div
                data-testid={`sentence-aside-${sentence.sentenceIndex}`}
                className="sentence-aside"
                style={{ minWidth: 0 }}
              >
                {renderAside ? renderAside(sentence.sentenceIndex) : null}
              </div>
            ) : null}
          </div>
          );
        })}
      </div>
    );
  }

  // Legacy flowing prose. F-8②: when the passage carries paragraphIndex, split it into <p> blocks at
  // each discourse break; passages generated before paragraphIndex existed render as one flow.
  const renderProseSentence = (sentence: IndexedSentence, trailingSpace: boolean): ReactNode => (
    <span key={sentence.sentenceIndex} data-sentence-index={sentence.sentenceIndex}>
      {renderSentence(sentence)}
      {renderAfterSentence ? renderAfterSentence(sentence.sentenceIndex) : null}
      {trailingSpace ? ' ' : null}
    </span>
  );

  const hasParagraphs = source.sentences.some((s) => s.paragraphIndex !== undefined);
  if (!hasParagraphs) {
    return (
      <div data-testid="passage-prose" data-layout="prose" style={proseStyle}>
        {passage.sentences.map((sentence) =>
          renderProseSentence(sentence, sentence.sentenceIndex < passage.sentences.length - 1),
        )}
      </div>
    );
  }

  const paragraphs: IndexedSentence[][] = [];
  let prevPara: number | undefined;
  for (const [i, sentence] of passage.sentences.entries()) {
    const pIdx = source.sentences[sentence.sentenceIndex]?.paragraphIndex;
    if (i === 0 || pIdx !== prevPara) paragraphs.push([sentence]);
    else paragraphs[paragraphs.length - 1]!.push(sentence);
    prevPara = pIdx;
  }
  return (
    <div data-testid="passage-prose" data-layout="prose" style={proseStyle}>
      {paragraphs.map((group, gi) => (
        <p key={`para-${gi}`} data-paragraph-index={gi} style={proseParagraphStyle}>
          {group.map((sentence, si) => renderProseSentence(sentence, si < group.length - 1))}
        </p>
      ))}
    </div>
  );
}

const speakerLabelStyle: CSSProperties = {
  display: 'inline-block',
  marginRight: 8,
  padding: '2px 7px',
  borderRadius: 6,
  background: colors.surfaceBlue,
  color: colors.primary,
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 700,
  verticalAlign: 'baseline',
};

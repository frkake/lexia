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

import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { AnnotatedSpan, type AnnotationKind } from '../shared/AnnotatedSpan';
import { noticeStyle, cueHighlight, colors, fonts } from '../theme/tokens';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type {
  IndexedPassage,
  IndexedSentence,
  IndexedToken,
  TargetSpan,
  CollocationSpan,
  NoticeCue,
  TokenId,
} from '../../types/domain';

const BASE_PROSE_PX = 19;

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

    return (
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
    const cuesByEnd = new Map<number, NoticeCue[]>();
    const cuesByToken = new Map<number, number[]>();
    for (const cue of source.noticeCues.filter((c) => c.span.sentenceIndex === sentenceIndex)) {
      const list = cuesByEnd.get(cue.span.tokenEnd) ?? [];
      list.push(cue);
      cuesByEnd.set(cue.span.tokenEnd, list);
      for (let t = cue.span.tokenStart; t < cue.span.tokenEnd; t += 1) {
        const ids = cuesByToken.get(t) ?? [];
        ids.push(cue.index);
        cuesByToken.set(t, ids);
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
      if (ids.length === 0) return ' ';
      return (
        <span key={key} className="cue-seg" data-cue-index={ids.join(' ')} style={segStyle(ids, withinChip)}>
          {' '}
        </span>
      );
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
              <span key={tok.tokenId} style={{ fontStyle: 'italic' }}>
                {tok.text}
              </span>,
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
      out.push(wrapCue(<span key={tok.tokenId}>{tok.text}</span>, cueIdsAt(i), false, `seg-${tok.tokenId}`));
      lastCharEnd = tok.charEnd;
      emitBadges(i + 1);
      i += 1;
    }

    // Safety net: surface any in-range cue not reached above (e.g. tokenEnd === tokens.length).
    emitBadges(tokens.length);

    return out;
  }

  if (layout === 'grid') {
    // Sentence-unit 2-column grid: each sentence is one row, English in the left cell and its
    // Japanese translation injected into the right cell (renderAside). Correspondence is kept by
    // construction — a sentence's translation can only land in its own row's right cell (3.1/3.2).
    return (
      <div data-testid="passage-prose" data-layout="grid" style={{ ...proseStyle, display: 'block' }}>
        {passage.sentences.map((sentence) => (
          <div
            key={sentence.sentenceIndex}
            data-testid={`sentence-row-${sentence.sentenceIndex}`}
            className="sentence-row"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
              columnGap: 26,
              alignItems: 'start',
              marginBottom: 14,
            }}
          >
            <div data-testid={`sentence-en-${sentence.sentenceIndex}`} className="sentence-en" style={{ minWidth: 0 }}>
              {renderSentence(sentence)}
            </div>
            <div
              data-testid={`sentence-aside-${sentence.sentenceIndex}`}
              className="sentence-aside"
              style={{ minWidth: 0 }}
            >
              {renderAside ? renderAside(sentence.sentenceIndex) : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="passage-prose" data-layout="prose" style={proseStyle}>
      {passage.sentences.map((sentence) => (
        <span key={sentence.sentenceIndex}>
          {renderSentence(sentence)}
          {renderAfterSentence ? renderAfterSentence(sentence.sentenceIndex) : null}
          {sentence.sentenceIndex < passage.sentences.length - 1 ? ' ' : null}
        </span>
      ))}
    </div>
  );
}

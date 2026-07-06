/**
 * L4 — ReadingGuideRail: a unified right rail for the reading page. It replaces the split
 * "notices" + "study words" lists with one appearance-ordered learning guide. Study words replace
 * only duplicate notices that point at the same word occurrence; broader phrases / grammar /
 * structure cues remain standalone guide cards.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { colors, fonts, noticeStyle, radius } from '../theme/tokens';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore, useEffectiveCue, useReadingUiStore } from '../../state/stores/readingUiStore';
import { studyWordLabel } from './StudyWordsList';
import type { LineAnchor } from './useLineAnchors';
import type { StudyWord } from './StudyWordsList';
import type { IndexedPassage, NoticeCue, SpanRef, TargetSpan } from '../../types/domain';

const GUIDE_GAP = 12;
/**
 * D-1: cards default to a single compact summary row (~44px) and expand on click, so the placement
 * fallback estimate is the compact height. Real heights are always measured from the DOM (ResizeObserver
 * + layout effect); this estimate only seeds the very first frame and the jsdom fallback.
 */
const COMPACT_CARD_HEIGHT = 48;
const REAPPEAR_THRESHOLD = 2;

export interface ReadingGuideNotice {
  cue: NoticeCue;
  expression: string;
}

export interface ReadingGuideStudyItem {
  kind: 'study';
  id: string;
  guideIndex: number;
  order: number;
  word: StudyWord;
  span: TargetSpan;
  notices: ReadingGuideNotice[];
}

export interface ReadingGuideNoticeItem {
  kind: 'notice';
  id: string;
  guideIndex: number;
  order: number;
  cue: NoticeCue;
  expression: string;
}

export type ReadingGuideItem = ReadingGuideStudyItem | ReadingGuideNoticeItem;

export interface ReadingGuide {
  items: ReadingGuideItem[];
  /** Lowercase wordId -> guide item anchor id (`word:...`). */
  wordAnchorIdByKey: Record<string, string>;
  /** Cue index -> guide item DOM id. Absorbed cues point at their study-word card. */
  cueTargetIdByIndex: Record<number, string>;
  /** Cue index -> unified guide number shown in the text badge. */
  guideNumberByCueIndex: Record<number, number>;
  /** Lowercase wordId -> unified guide number shown at the first study-word occurrence. */
  guideNumberByWordKey: Record<string, number>;
  /** Cue indices whose prose-side notice badge is replaced by the study-word badge. */
  absorbedCueIndexByIndex: Record<number, true>;
}

export interface PlacedGuideItem {
  itemId: string;
  top: number;
}

function keyOf(wordId: string): string {
  return wordId.trim().toLowerCase();
}

export function guideItemIdForWord(wordId: string): string {
  return `word:${encodeURIComponent(keyOf(wordId))}`;
}

export function guideItemIdForNotice(cueIndex: number): string {
  return `notice:${cueIndex}`;
}

export function guideItemDomId(itemId: string): string {
  return `guide-item-${itemId}`;
}

function positionOf(span: SpanRef): number {
  return span.sentenceIndex * 10_000 + span.tokenStart;
}

function sameSpan(a: SpanRef, b: SpanRef): boolean {
  return a.sentenceIndex === b.sentenceIndex && a.tokenStart === b.tokenStart && a.tokenEnd === b.tokenEnd;
}

function expressionFor(passage: IndexedPassage, span: SpanRef): string {
  const sentence = passage.source.sentences[span.sentenceIndex];
  if (!sentence) return '';
  const tokens = sentence.tokens.slice(span.tokenStart, span.tokenEnd);
  return tokenizer.renderText({ tokens, translationJa: '' }).trim();
}

function firstTargetsByWord(passage: IndexedPassage): TargetSpan[] {
  const sorted = [...passage.source.targetSpans].sort(
    (a, b) => a.sentenceIndex - b.sentenceIndex || a.tokenStart - b.tokenStart || a.tokenEnd - b.tokenEnd,
  );
  const seen = new Set<string>();
  const firsts: TargetSpan[] = [];
  for (const span of sorted) {
    const key = keyOf(span.wordId);
    if (seen.has(key)) continue;
    seen.add(key);
    firsts.push(span);
  }
  return firsts;
}

function fallbackStudyWord(span: TargetSpan): StudyWord {
  return {
    wordId: span.wordId,
    surface: span.wordId.trim() || span.surface,
    reappearCount: span.reappearInfo?.count,
  };
}

function noticeSort(a: NoticeCue, b: NoticeCue): number {
  return a.span.sentenceIndex - b.span.sentenceIndex || a.span.tokenStart - b.span.tokenStart || a.index - b.index;
}

function normalizedSurface(value: string): string {
  return value.trim().toLowerCase();
}

function isDuplicateWordNotice(cue: NoticeCue, expression: string, item: ReadingGuideStudyItem): boolean {
  const sameWordId = cue.wordId !== undefined && keyOf(cue.wordId) === keyOf(item.word.wordId);
  const sameOccurrence = sameSpan(cue.span, item.span);
  const sameExpression = normalizedSurface(expression) === normalizedSurface(item.span.surface || item.word.surface || item.word.wordId);
  // Only collapse the notice when it is the same word occurrence. A phrase/collocation that merely
  // contains the study word ("closed the deal") is a separate thing the learner should still see.
  return sameOccurrence && (sameWordId || sameExpression);
}

export function buildReadingGuide(passage: IndexedPassage, words: StudyWord[]): ReadingGuide {
  const studyWordByKey = new Map(words.map((word) => [keyOf(word.wordId), word] as const));
  const studyItemsByKey = new Map<string, ReadingGuideStudyItem>();
  const wordAnchorIdByKey: Record<string, string> = {};

  for (const span of firstTargetsByWord(passage)) {
    const key = keyOf(span.wordId);
    const id = guideItemIdForWord(span.wordId);
    wordAnchorIdByKey[key] = id;
    studyItemsByKey.set(key, {
      kind: 'study',
      id,
      guideIndex: 0,
      order: positionOf(span),
      word: studyWordByKey.get(key) ?? fallbackStudyWord(span),
      span,
      notices: [],
    });
  }

  const standaloneNotices: ReadingGuideNoticeItem[] = [];
  const cueTargetIdByIndex: Record<number, string> = {};
  const absorbedCueIndexByIndex: Record<number, true> = {};
  const studyItems = [...studyItemsByKey.values()].sort((a, b) => a.order - b.order);

  for (const cue of [...passage.source.noticeCues].sort(noticeSort)) {
    const expression = expressionFor(passage, cue.span);
    let owner: ReadingGuideStudyItem | undefined;
    if (cue.wordId) {
      const candidate = studyItemsByKey.get(keyOf(cue.wordId));
      owner = candidate && isDuplicateWordNotice(cue, expression, candidate) ? candidate : undefined;
    }
    if (!owner) {
      owner = studyItems.find((item) => isDuplicateWordNotice(cue, expression, item));
    }

    if (owner) {
      owner.notices.push({ cue, expression });
      cueTargetIdByIndex[cue.index] = guideItemDomId(owner.id);
      absorbedCueIndexByIndex[cue.index] = true;
      continue;
    }

    const id = guideItemIdForNotice(cue.index);
    cueTargetIdByIndex[cue.index] = guideItemDomId(id);
    standaloneNotices.push({
      kind: 'notice',
      id,
      guideIndex: 0,
      order: positionOf(cue.span),
      cue,
      expression,
    });
  }

  const items = [...studyItems, ...standaloneNotices]
    .sort((a, b) => a.order - b.order || (a.kind === 'study' ? -1 : 1))
    .map((item, index) => ({ ...item, guideIndex: index + 1 }));
  const guideNumberByCueIndex: Record<number, number> = {};
  const guideNumberByWordKey: Record<string, number> = {};
  for (const item of items) {
    if (item.kind === 'study') {
      guideNumberByWordKey[keyOf(item.word.wordId)] = item.guideIndex;
      for (const notice of item.notices) guideNumberByCueIndex[notice.cue.index] = item.guideIndex;
    } else {
      guideNumberByCueIndex[item.cue.index] = item.guideIndex;
    }
  }

  return {
    items,
    wordAnchorIdByKey,
    cueTargetIdByIndex,
    guideNumberByCueIndex,
    guideNumberByWordKey,
    absorbedCueIndexByIndex,
  };
}

function estimatedHeight(_item: ReadingGuideItem): number {
  // Both kinds share the same collapsed baseline; expanded height is measured, never estimated.
  return COMPACT_CARD_HEIGHT;
}

export function placeGuideItems(
  items: ReadingGuideItem[],
  anchors: LineAnchor[],
  heights: Record<string, number> = {},
  railOriginTop = 0,
): PlacedGuideItem[] {
  const topById = new Map(
    anchors
      .map((anchor) => [anchor.itemId ?? (anchor.cueIndex !== undefined ? guideItemIdForNotice(anchor.cueIndex) : ''), anchor.top] as const)
      .filter(([id]) => id),
  );
  const placed: PlacedGuideItem[] = [];
  let prevBottom = -Infinity;
  for (const item of items) {
    // Anchors are measured relative to the common frame (`.reading-layout`); subtract the rail body's
    // own frame-relative origin so a card lands on its badge's line inside the rail's coordinate space.
    const anchorTop = topById.get(item.id);
    const desiredTop = anchorTop !== undefined ? anchorTop - railOriginTop : (Number.isFinite(prevBottom) ? prevBottom : 0);
    const top = Math.max(desiredTop, prevBottom);
    placed.push({ itemId: item.id, top });
    prevBottom = top + (heights[item.id] ?? estimatedHeight(item)) + GUIDE_GAP;
  }
  return placed;
}

function frequencyText(value?: number): string | null {
  if (value === undefined) return null;
  return `頻度 ${Math.max(1, Math.min(5, value))}/5`;
}

function jumpToBadge(cueIndex: number): void {
  if (typeof document === 'undefined') return;
  document.getElementById(`notice-badge-${cueIndex}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function jumpToStudyMarker(itemId: string, fallbackCueIndex: number): void {
  if (typeof document === 'undefined') return;
  const marker =
    document.getElementById(`inline-guide-badge-${itemId}`) ??
    document.querySelector<HTMLElement>(`[data-line-anchor="${itemId}"]`) ??
    document.getElementById(`notice-badge-${fallbackCueIndex}`);
  marker?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function stopAndRun(event: MouseEvent, fn: () => void): void {
  event.stopPropagation();
  fn();
}

function StudyGuideCard({
  item,
  active,
  expanded,
  onToggle,
  placedTop,
  registerRef,
  onSelectWord,
  onPlayWord,
  onMarkUnknown,
  markingUnknownId,
}: {
  item: ReadingGuideStudyItem;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  placedTop?: number;
  registerRef: (node: HTMLDivElement | null) => void;
  onSelectWord?: (wordId: string) => void;
  onPlayWord?: (wordId: string) => void;
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
  markingUnknownId: string | null;
}) {
  const word = item.word;
  const label = studyWordLabel(word);
  const firstCue = item.notices[0]?.cue.index ?? null;
  const isUnknownPending = markingUnknownId !== null;
  const isMarkingUnknown = markingUnknownId === word.wordId;
  const setHover = (value: number | null): void => {
    if (firstCue !== null) readingUiStore.getState().setHover(value);
  };

  // D-1 compact card: a single summary row (number · word · gloss · chevron); clicking the card
  // toggles the detail below (meaning · chips · memory tip · absorbed notices · actions). Opening the
  // full word detail moves to the "解説を開く ›" action so the card body click is reserved for expand.
  return (
    <article
      ref={registerRef}
      id={guideItemDomId(item.id)}
      data-testid={`guide-item-${item.id}`}
      data-guide-kind="study"
      aria-current={active ? 'true' : undefined}
      aria-expanded={expanded}
      onMouseEnter={() => setHover(firstCue)}
      onMouseLeave={() => setHover(null)}
      onClick={onToggle}
      style={guideCardStyle(active, placedTop)}
    >
      {/* D-8: the summary row is the real focusable disclosure control, so the card no longer needs
          role="button" — which nested the inner action buttons inside an interactive element
          (nested-interactive). The action buttons live in the sibling detail block below, never inside
          this button, so no interactive control is nested within another. */}
      <button
        type="button"
        data-testid={`guide-toggle-${item.id}`}
        aria-expanded={expanded}
        aria-label={`${label} の学習ガイド`}
        onClick={(event) => stopAndRun(event, onToggle)}
        onFocus={() => setHover(firstCue)}
        onBlur={() => setHover(null)}
        style={summaryButtonStyle}
      >
        <span style={{ ...guideNumberStyle, background: colors.primary }}>{item.guideIndex}</span>
        <span style={compactLabelStyle}>{label}</span>
        {!expanded ? (
          word.meaningJa ? <span style={compactMeaningStyle}>{word.meaningJa}</span> : <span style={compactMetaStyle}>学習語句</span>
        ) : null}
        <span aria-hidden="true" style={chevronStyle(expanded)}>›</span>
      </button>

      {expanded ? (
        <div style={expandedBodyStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={studyBadgeStyle}>学習語句</span>
            {frequencyText(word.frequency) ? <span style={subtleMetaStyle}>{frequencyText(word.frequency)}</span> : null}
          </div>
          {word.meaningJa ? <div style={meaningStyle}>{word.meaningJa}</div> : null}

          {word.collocation || word.register || word.connotation ? (
            <div style={miniChipRowStyle}>
              {word.collocation ? <span style={miniChipStyle}>{word.collocation}</span> : null}
              {word.register ? <span style={miniChipStyle}>{word.register}</span> : null}
              {word.connotation ? <span style={miniChipStyle}>{word.connotation}</span> : null}
            </div>
          ) : null}
          {word.memoryTipJa ? <div style={memoryTipStyle}>{word.memoryTipJa}</div> : null}

          {item.notices.length > 0 ? (
            <div style={absorbedListStyle}>
              {item.notices.map(({ cue, expression }) => {
                const style = noticeStyle(cue.category);
                return (
                  <button
                    key={cue.index}
                    type="button"
                    data-testid={`guide-absorbed-notice-${cue.index}`}
                    onClick={(event) => stopAndRun(event, () => {
                      readingUiStore.getState().setPinned(cue.index);
                      jumpToStudyMarker(item.id, cue.index);
                    })}
                    onKeyDown={(event) => event.stopPropagation()}
                    onMouseEnter={() => readingUiStore.getState().setHover(cue.index)}
                    onMouseLeave={() => readingUiStore.getState().setHover(null)}
                    style={absorbedNoticeStyle}
                  >
                    <span style={absorbedExpressionStyle}>{expression}</span>
                    <span style={{ ...noticeChipStyle, ...chipNowrapStyle, color: style.color, background: style.bg }}>{style.label}</span>
                    <span style={absorbedExplanationStyle}>{cue.explanationJa}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {(word.reappearCount ?? 0) >= REAPPEAR_THRESHOLD ? (
            <div style={reappearNoteStyle}>
              <b style={{ color: colors.ink }}>{label}</b> は今回が{word.reappearCount}回目。
              違う文脈で再登場させ、定着へ近づけます。
            </div>
          ) : null}

          <div style={actionRowStyle}>
            {onPlayWord ? (
              <button
                type="button"
                aria-label={`${label} の発音を再生`}
                onClick={(event) => stopAndRun(event, () => onPlayWord(word.wordId))}
                onKeyDown={(event) => event.stopPropagation()}
                style={iconButtonStyle}
              >
                ▶
              </button>
            ) : null}
            {onMarkUnknown ? (
              <button
                type="button"
                aria-label={`${label} を知らなかったとして記録`}
                data-testid={`guide-mark-unknown-${word.wordId}`}
                disabled={isUnknownPending}
                aria-busy={isMarkingUnknown}
                onClick={(event) => stopAndRun(event, () => void onMarkUnknown(word.wordId))}
                onKeyDown={(event) => event.stopPropagation()}
                style={unknownButtonStyle(isUnknownPending)}
              >
                {isMarkingUnknown ? '記録中…' : '知らなかった'}
              </button>
            ) : null}
            {onSelectWord ? (
              <button
                type="button"
                data-testid={`guide-open-detail-${word.wordId}`}
                onClick={(event) => stopAndRun(event, () => onSelectWord(word.wordId))}
                onKeyDown={(event) => event.stopPropagation()}
                style={openDetailButtonStyle}
              >
                解説を開く ›
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function NoticeGuideCard({
  item,
  active,
  expanded,
  autoDetail,
  onToggle,
  placedTop,
  registerRef,
  onMarkUnknown,
  markingUnknownId,
}: {
  item: ReadingGuideNoticeItem;
  active: boolean;
  expanded: boolean;
  /** True when this cue is pinned (C-1): its detailJa auto-opens rather than needing a second click. */
  autoDetail: boolean;
  onToggle: () => void;
  placedTop?: number;
  registerRef: (node: HTMLDivElement | null) => void;
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
  markingUnknownId: string | null;
}) {
  const style = noticeStyle(item.cue.category);
  const markTargetId = item.cue.wordId ?? item.expression;
  const isUnknownPending = markingUnknownId !== null;
  const isMarkingUnknown = markingUnknownId === markTargetId;
  const detailJa = item.cue.detailJa;
  const [detailOpen, setDetailOpen] = useState(false);
  // Pinning the cue (in-text badge / jump) reveals its deeper explanation automatically (C-1).
  useEffect(() => {
    if (autoDetail && detailJa) setDetailOpen(true);
  }, [autoDetail, detailJa]);
  const setHover = readingUiStore.getState().setHover;
  const jumpToProse = (): void => {
    readingUiStore.getState().setPinned(item.cue.index);
    jumpToBadge(item.cue.index);
  };

  // D-1 compact card: the summary shows number · expression · category chip; the explanation and
  // the actions (jump to the prose, mark unknown) live in the expand-on-click detail.
  return (
    <article
      ref={registerRef}
      id={guideItemDomId(item.id)}
      data-testid={`guide-item-${item.id}`}
      data-guide-kind="notice"
      aria-current={active ? 'true' : undefined}
      aria-expanded={expanded}
      onMouseEnter={() => setHover(item.cue.index)}
      onMouseLeave={() => setHover(null)}
      onClick={onToggle}
      style={guideCardStyle(active, placedTop)}
    >
      {/* D-8: focusable disclosure control (see StudyGuideCard) — flattens nested-interactive. */}
      <button
        type="button"
        data-testid={`guide-toggle-${item.id}`}
        aria-expanded={expanded}
        aria-controls={`notice-badge-${item.cue.index}`}
        aria-label={`${item.expression} の学習ガイド`}
        onClick={(event) => stopAndRun(event, onToggle)}
        onFocus={() => setHover(item.cue.index)}
        onBlur={() => setHover(null)}
        style={summaryButtonStyle}
      >
        <span style={{ ...noticeNumberStyle, background: style.numberColor }}>{item.guideIndex}</span>
        <span style={compactExpressionStyle}>{item.expression}</span>
        <span style={{ ...noticeChipStyle, ...chipNowrapStyle, color: style.color, background: style.bg }}>{style.label}</span>
        <span aria-hidden="true" style={chevronStyle(expanded)}>›</span>
      </button>

      {expanded ? (
        <div style={expandedBodyStyle}>
          <div style={noticeExplanationStyle}>{item.cue.explanationJa}</div>
          {detailJa ? (
            <div style={detailBlockStyle}>
              <button
                type="button"
                data-testid={`guide-notice-detail-toggle-${item.cue.index}`}
                aria-expanded={detailOpen}
                onClick={(event) => stopAndRun(event, () => setDetailOpen((v) => !v))}
                onKeyDown={(event) => event.stopPropagation()}
                style={detailToggleStyle}
              >
                {detailOpen ? '詳しく ▾' : '詳しく ▸'}
              </button>
              {detailOpen ? (
                <div data-testid={`guide-notice-detail-${item.cue.index}`} style={detailTextStyle}>
                  {detailJa}
                </div>
              ) : null}
            </div>
          ) : null}
          <div style={actionRowStyle}>
            <button
              type="button"
              data-testid={`guide-notice-jump-${item.cue.index}`}
              onClick={(event) => stopAndRun(event, jumpToProse)}
              onKeyDown={(event) => event.stopPropagation()}
              style={openDetailButtonStyle}
            >
              本文へ ›
            </button>
            {onMarkUnknown ? (
              <button
                type="button"
                aria-label={`${item.expression} を知らなかったとして記録`}
                data-testid={`guide-notice-mark-unknown-${item.cue.index}`}
                disabled={isUnknownPending}
                aria-busy={isMarkingUnknown}
                onClick={(event) => stopAndRun(event, () => void onMarkUnknown(markTargetId))}
                onKeyDown={(event) => event.stopPropagation()}
                style={unknownButtonStyle(isUnknownPending)}
              >
                {isMarkingUnknown ? '記録中…' : '知らなかった'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export interface ReadingGuideRailProps {
  passage: IndexedPassage;
  words: StudyWord[];
  guide?: ReadingGuide;
  anchors?: LineAnchor[];
  onSelectWord?: (wordId: string) => void;
  onPlayWord?: (wordId: string) => void;
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
}

export function ReadingGuideRail({
  passage,
  words,
  guide: suppliedGuide,
  anchors,
  onSelectWord,
  onPlayWord,
  onMarkUnknown,
}: ReadingGuideRailProps) {
  const builtGuide = useMemo(() => suppliedGuide ?? buildReadingGuide(passage, words), [passage, suppliedGuide, words]);
  const [markingUnknownId, setMarkingUnknownId] = useState<string | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  // Rail body's own frame-relative origin: the anchors are measured against the shared frame, so we
  // subtract this to translate them into the absolutely-positioned rail body's coordinate space (D-1).
  const [railOriginTop, setRailOriginTop] = useState(0);
  // Bumped by the rail-body/card ResizeObserver so a rail-width change (which reflows card heights)
  // re-triggers the measure→place pass even when the prose anchors did not move.
  const [measureTick, setMeasureTick] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const railBodyRef = useRef<HTMLDivElement | null>(null);
  const activeCueIndex = useEffectiveCue();
  const pinnedCueIndex = useReadingUiStore((s) => s.pinnedCueIndex);
  const aligned = anchors !== undefined && anchors.length > 0;

  // Cards collapse back to their compact summary when the passage changes.
  useEffect(() => {
    setExpandedIds(new Set());
  }, [passage.passageId]);

  // Preserve the spotlight flow: pinning a cue (clicking its in-text badge or a jump action) auto-opens
  // the matching guide card so its explanation is revealed rather than scrolling to a collapsed card.
  useEffect(() => {
    if (pinnedCueIndex === null) return;
    const target = builtGuide.items.find((item) =>
      item.kind === 'study'
        ? item.notices.some((notice) => notice.cue.index === pinnedCueIndex)
        : item.cue.index === pinnedCueIndex,
    );
    if (!target) return;
    setExpandedIds((prev) => (prev.has(target.id) ? prev : new Set(prev).add(target.id)));
  }, [pinnedCueIndex, builtGuide]);

  // Measure real card heights AND the rail body's frame-relative origin. Re-runs whenever the anchors
  // move, a card expands/collapses, or a ResizeObserver fires (measureTick) — so heights are always the
  // live measured values (fixing the stale-height overlap) and the origin follows layout shifts.
  useLayoutEffect(() => {
    if (!aligned) return;
    const next: Record<string, number> = {};
    for (const item of builtGuide.items) {
      const node = itemRefs.current.get(item.id);
      next[item.id] = node?.getBoundingClientRect().height || estimatedHeight(item);
    }
    setHeights((prev) => {
      const same =
        Object.keys(prev).length === Object.keys(next).length &&
        Object.entries(next).every(([key, value]) => prev[key] === value);
      return same ? prev : next;
    });
    const body = railBodyRef.current;
    if (body) {
      const frame = body.closest('.reading-layout');
      const frameTop = frame ? frame.getBoundingClientRect().top : 0;
      const origin = body.getBoundingClientRect().top - frameTop;
      setRailOriginTop((prev) => (prev === origin ? prev : origin));
    }
  }, [aligned, builtGuide, anchors, measureTick, expandedIds]);

  // Remeasure on any width/height change of the rail body or an individual card (reflow / expand).
  useEffect(() => {
    if (!aligned) return;
    const body = railBodyRef.current;
    if (!body || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    observer.observe(body);
    for (const node of itemRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [aligned, builtGuide, expandedIds]);

  const toggleExpand = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const placed = aligned ? placeGuideItems(builtGuide.items, anchors, heights, railOriginTop) : [];
  const topById = new Map(placed.map((item) => [item.itemId, item.top] as const));
  const containerHeight = aligned
    ? placed.reduce((max, item) => Math.max(max, item.top + (heights[item.itemId] ?? estimatedHeight(builtGuide.items.find((i) => i.id === item.itemId)!))), 0)
    : undefined;

  const markUnknown = async (targetId: string): Promise<void> => {
    if (!onMarkUnknown || markingUnknownId) return;
    setMarkingUnknownId(targetId);
    try {
      await onMarkUnknown(targetId);
    } catch {
      // Keep the guide usable if persistence fails; this mirrors the previous rail behavior.
    } finally {
      setMarkingUnknownId(null);
    }
  };

  return (
    <section>
      <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
        学習ガイド
      </div>
      <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 16 }}>
        初めて出る位置で、語句と気づきをまとめて確認
      </div>
      <div
        ref={railBodyRef}
        style={
          aligned
            ? { position: 'relative', height: containerHeight }
            : { display: 'flex', flexDirection: 'column', gap: GUIDE_GAP }
        }
      >
        {builtGuide.items.map((item) => {
          const active =
            item.kind === 'study'
              ? item.notices.some((notice) => notice.cue.index === activeCueIndex)
              : item.cue.index === activeCueIndex;
          const placedTop = aligned ? topById.get(item.id) : undefined;
          const registerRef = (node: HTMLDivElement | null): void => {
            if (node) itemRefs.current.set(item.id, node);
            else itemRefs.current.delete(item.id);
          };
          const expanded = expandedIds.has(item.id);
          return item.kind === 'study' ? (
            <StudyGuideCard
              key={item.id}
              item={item}
              active={active}
              expanded={expanded}
              onToggle={() => toggleExpand(item.id)}
              placedTop={placedTop}
              registerRef={registerRef}
              onSelectWord={onSelectWord}
              onPlayWord={onPlayWord}
              onMarkUnknown={onMarkUnknown ? markUnknown : undefined}
              markingUnknownId={markingUnknownId}
            />
          ) : (
            <NoticeGuideCard
              key={item.id}
              item={item}
              active={active}
              expanded={expanded}
              autoDetail={pinnedCueIndex === item.cue.index}
              onToggle={() => toggleExpand(item.id)}
              placedTop={placedTop}
              registerRef={registerRef}
              onMarkUnknown={onMarkUnknown ? markUnknown : undefined}
              markingUnknownId={markingUnknownId}
            />
          );
        })}
      </div>
    </section>
  );
}

const guideCardStyle = (active: boolean, placedTop?: number, interactive = true): CSSProperties => ({
  padding: '11px 12px',
  border: `1px solid ${active ? colors.primaryBorder : colors.borderCard}`,
  borderRadius: radius.card,
  background: active ? colors.surfaceBlue : colors.surfaceCard,
  boxShadow: active ? `inset 3px 0 0 ${colors.primary}` : undefined,
  transition: 'background .12s, border-color .12s, box-shadow .12s',
  ...(interactive ? { cursor: 'pointer' } : null),
  ...(placedTop !== undefined ? { position: 'absolute', top: placedTop, left: 0, right: 0 } : null),
});

/** D-1/D-8 compact summary row (number · label · one-liner · chevron) — the always-visible card head,
 *  rendered as a full-width <button> so it is the card's keyboard-operable disclosure control. */
const summaryButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  minWidth: 0,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const compactLabelStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 16,
  color: colors.ink,
  flex: '0 1 auto',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const compactExpressionStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 15,
  color: colors.ink,
  flex: '0 1 auto',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

/** Single-line gloss shown next to the label when collapsed; truncates rather than growing the row. */
const compactMeaningStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  color: colors.inkSoft,
  flex: '1 1 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const compactMetaStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.faint,
  flex: '1 1 auto',
  minWidth: 0,
};

const chevronStyle = (expanded: boolean): CSSProperties => ({
  flex: 'none',
  marginLeft: 'auto',
  fontFamily: fonts.ui,
  fontSize: 15,
  lineHeight: 1,
  color: colors.faint,
  transform: expanded ? 'rotate(90deg)' : 'none',
  transition: 'transform .12s',
});

/** The expand-on-click detail block below the summary. */
const expandedBodyStyle: CSSProperties = {
  marginTop: 11,
};

const actionRowStyle: CSSProperties = {
  marginTop: 12,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
};

const openDetailButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '6px 10px',
  cursor: 'pointer',
};

const chipNowrapStyle: CSSProperties = {
  whiteSpace: 'nowrap',
  flex: 'none',
};

const guideNumberStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 21,
  height: 21,
  borderRadius: '50%',
  color: '#fff',
  fontFamily: fonts.num,
  fontSize: 11,
  fontWeight: 700,
  marginTop: 1,
};

const studyBadgeStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  fontWeight: 700,
  color: colors.primaryDeep,
  background: colors.surfaceBlue,
  borderRadius: 4,
  padding: '2px 7px',
};

const subtleMetaStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.faint,
};

const meaningStyle: CSSProperties = {
  marginTop: 5,
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: colors.inkSoft,
};

const miniChipRowStyle: CSSProperties = {
  marginTop: 9,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
};

const miniChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 20,
  maxWidth: '100%',
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.primaryDeep,
  background: colors.surfaceBlue,
  borderRadius: radius.chip,
  padding: '2px 7px',
  overflowWrap: 'anywhere',
};

const memoryTipStyle: CSSProperties = {
  marginTop: 8,
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: colors.greenDeep,
};

const absorbedListStyle: CSSProperties = {
  marginTop: 11,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

// D-1: the absorbed-notice row used a 2-column grid whose auto-placement dropped the explanation into
// column 1 and squeezed the CJK chip so its label broke one glyph per line. A wrapping flex row instead
// lets line 1 hold the expression + a nowrap chip and line 2 (width:100%) hold the full explanation.
const absorbedNoticeStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '4px 7px',
  width: '100%',
  padding: '8px 9px',
  textAlign: 'left',
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.control,
  cursor: 'pointer',
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  lineHeight: 1.45,
};

const absorbedExpressionStyle: CSSProperties = {
  color: colors.inkSoft,
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const absorbedExplanationStyle: CSSProperties = {
  color: colors.ink,
  width: '100%',
};

const noticeNumberStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 19,
  height: 19,
  borderRadius: '50%',
  color: '#fff',
  fontFamily: fonts.num,
  fontSize: 11,
  fontWeight: 700,
  marginTop: 1,
};

const noticeChipStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.03em',
  borderRadius: 4,
  padding: '2px 7px',
};

const noticeExplanationStyle: CSSProperties = {
  marginTop: 7,
  fontFamily: fonts.bodyJp,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: colors.inkSoft,
};

/** C-1: the expandable「詳しく」detail block (origin / parse explanation) under a cue's explanationJa. */
const detailBlockStyle: CSSProperties = {
  marginTop: 8,
};

const detailToggleStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.primary,
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
};

const detailTextStyle: CSSProperties = {
  marginTop: 6,
  padding: '8px 10px',
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.control,
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  lineHeight: 1.6,
  color: colors.ink,
};

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: `1px solid ${colors.primaryBorder2}`,
  background: colors.surfaceBlue,
  color: colors.primary,
  fontSize: 10,
  cursor: 'pointer',
};

const unknownButtonStyle = (disabled: boolean): CSSProperties => ({
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
});

const reappearNoteStyle: CSSProperties = {
  marginTop: 12,
  background: colors.surfaceSubtle,
  borderRadius: radius.control,
  padding: '9px 10px',
  border: `1px solid ${colors.borderCard}`,
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  lineHeight: 1.55,
  color: colors.inkSoft,
};

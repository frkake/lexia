/**
 * L4 — ReadingGuideRail: a unified right rail for the reading page. It replaces the split
 * "notices" + "study words" lists with one appearance-ordered learning guide. Study words replace
 * only duplicate notices that point at the same word occurrence; broader phrases / grammar /
 * structure cues remain standalone guide cards.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { colors, fonts, noticeStyle, radius } from '../theme/tokens';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import { studyWordLabel } from './StudyWordsList';
import type { LineAnchor } from './useLineAnchors';
import type { StudyWord } from './StudyWordsList';
import type { IndexedPassage, NoticeCue, SpanRef, TargetSpan } from '../../types/domain';

const GUIDE_GAP = 12;
const STUDY_WORD_MIN_HEIGHT = 118;
const NOTICE_MIN_HEIGHT = 94;
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

function estimatedHeight(item: ReadingGuideItem): number {
  if (item.kind === 'notice') return NOTICE_MIN_HEIGHT;
  return STUDY_WORD_MIN_HEIGHT + item.notices.length * 58 + ((item.word.reappearCount ?? 0) >= REAPPEAR_THRESHOLD ? 48 : 0);
}

export function placeGuideItems(
  items: ReadingGuideItem[],
  anchors: LineAnchor[],
  heights: Record<string, number> = {},
): PlacedGuideItem[] {
  const topById = new Map(
    anchors
      .map((anchor) => [anchor.itemId ?? (anchor.cueIndex !== undefined ? guideItemIdForNotice(anchor.cueIndex) : ''), anchor.top] as const)
      .filter(([id]) => id),
  );
  const placed: PlacedGuideItem[] = [];
  let prevBottom = -Infinity;
  for (const item of items) {
    const desiredTop = topById.get(item.id) ?? (Number.isFinite(prevBottom) ? prevBottom : 0);
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
  placedTop,
  registerRef,
  onSelectWord,
  onPlayWord,
  onMarkUnknown,
  markingUnknownId,
}: {
  item: ReadingGuideStudyItem;
  active: boolean;
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
  const selectable = Boolean(onSelectWord);
  const setHover = (value: number | null): void => {
    if (firstCue !== null) readingUiStore.getState().setHover(value);
  };

  return (
    <article
      ref={registerRef}
      id={guideItemDomId(item.id)}
      data-testid={`guide-item-${item.id}`}
      data-guide-kind="study"
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => setHover(firstCue)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(firstCue)}
      onBlur={() => setHover(null)}
      onClick={() => onSelectWord?.(word.wordId)}
      onKeyDown={(event) => {
        if (!selectable) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectWord?.(word.wordId);
        }
      }}
      style={guideCardStyle(active, placedTop)}
    >
      <div style={studyHeaderStyle}>
        <span style={{ ...guideNumberStyle, background: colors.primary }}>{item.guideIndex}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>{label}</span>
            <span style={studyBadgeStyle}>学習語句</span>
            {frequencyText(word.frequency) ? <span style={subtleMetaStyle}>{frequencyText(word.frequency)}</span> : null}
          </div>
          {word.meaningJa ? <div style={meaningStyle}>{word.meaningJa}</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
          {onPlayWord ? (
            <button
              type="button"
              aria-label={`${label} の発音を再生`}
              onClick={(event) => stopAndRun(event, () => onPlayWord(word.wordId))}
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
              style={unknownButtonStyle(isUnknownPending)}
            >
              {isMarkingUnknown ? '記録中…' : '知らなかった'}
            </button>
          ) : null}
        </div>
      </div>

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
                onMouseEnter={() => readingUiStore.getState().setHover(cue.index)}
                onMouseLeave={() => readingUiStore.getState().setHover(null)}
                style={absorbedNoticeStyle}
              >
                <span style={{ color: colors.inkSoft }}>{expression}</span>
                <span style={{ ...noticeChipStyle, color: style.color, background: style.bg }}>{style.label}</span>
                <span style={{ color: colors.ink }}>{cue.explanationJa}</span>
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
    </article>
  );
}

function NoticeGuideCard({
  item,
  active,
  placedTop,
  registerRef,
  onMarkUnknown,
  markingUnknownId,
}: {
  item: ReadingGuideNoticeItem;
  active: boolean;
  placedTop?: number;
  registerRef: (node: HTMLDivElement | null) => void;
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
  markingUnknownId: string | null;
}) {
  const style = noticeStyle(item.cue.category);
  const markTargetId = item.cue.wordId ?? item.expression;
  const isUnknownPending = markingUnknownId !== null;
  const isMarkingUnknown = markingUnknownId === markTargetId;
  const setHover = readingUiStore.getState().setHover;
  const activate = (): void => {
    readingUiStore.getState().setPinned(item.cue.index);
    jumpToBadge(item.cue.index);
  };

  return (
    <article
      ref={registerRef}
      id={guideItemDomId(item.id)}
      data-testid={`guide-item-${item.id}`}
      data-guide-kind="notice"
      role="button"
      tabIndex={0}
      aria-controls={`notice-badge-${item.cue.index}`}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => setHover(item.cue.index)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(item.cue.index)}
      onBlur={() => setHover(null)}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      }}
      style={guideCardStyle(active, placedTop)}
    >
      <div style={noticeHeaderStyle}>
        <span style={{ ...noticeNumberStyle, background: style.numberColor }}>{item.guideIndex}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>{item.expression}</span>
            <span style={{ ...noticeChipStyle, color: style.color, background: style.bg }}>{style.label}</span>
          </div>
          <div style={noticeExplanationStyle}>{item.cue.explanationJa}</div>
        </div>
        {onMarkUnknown ? (
          <button
            type="button"
            aria-label={`${item.expression} を知らなかったとして記録`}
            data-testid={`guide-notice-mark-unknown-${item.cue.index}`}
            disabled={isUnknownPending}
            aria-busy={isMarkingUnknown}
            onClick={(event) => stopAndRun(event, () => void onMarkUnknown(markTargetId))}
            style={unknownButtonStyle(isUnknownPending)}
          >
            {isMarkingUnknown ? '記録中…' : '知らなかった'}
          </button>
        ) : null}
      </div>
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
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const activeCueIndex = useEffectiveCue();
  const aligned = anchors !== undefined && anchors.length > 0;

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
  }, [aligned, builtGuide]);

  const placed = aligned ? placeGuideItems(builtGuide.items, anchors, heights) : [];
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
          return item.kind === 'study' ? (
            <StudyGuideCard
              key={item.id}
              item={item}
              active={active}
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

const guideCardStyle = (active: boolean, placedTop?: number): CSSProperties => ({
  padding: '13px 13px 14px',
  border: `1px solid ${active ? colors.primaryBorder : colors.borderCard}`,
  borderRadius: radius.card,
  background: active ? colors.surfaceBlue : colors.surfaceCard,
  boxShadow: active ? `inset 3px 0 0 ${colors.primary}` : undefined,
  transition: 'background .12s, border-color .12s, box-shadow .12s',
  ...(placedTop !== undefined ? { position: 'absolute', top: placedTop, left: 0, right: 0 } : null),
});

const studyHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
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
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.primaryDeep,
  background: colors.surfaceBlue,
  borderRadius: radius.chip,
  padding: '2px 7px',
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

const absorbedNoticeStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, .9fr)',
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

const noticeHeaderStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
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

/**
 * L4 — WordbookScreen (design.md "WordbookScreen", 11.1–11.3). Lists the learner's words
 * with their mastery state, offers a mastery-stage filter and a headword/gloss search, and
 * opens the WordDetailCard on selection. It has no dedicated mock frame, so it composes the
 * shared primitives (MasteryDot) and design tokens to stay visually consistent with the
 * other screens. Presentational: the reactive word list is read upstream (useScheduling /
 * useLiveQuery + WordCacheRepository) and supplied via props; the detail card is injected
 * like ReadingScreen's `renderWordDetail`.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { MasteryDot } from '../shared/MasteryDot';
import { ModalOverlay } from '../shared/ModalOverlay';
import { dueLabel, isDueToday } from '../shared/dueLabel';
import { masteryColors, colors, fonts, radius, shadow } from '../theme/tokens';
import type { MasteryStage } from '../../types/domain';

export interface WordbookEntry {
  wordId: string;
  headword: string;
  /** Legacy single gloss (kept for search + fallback); superseded by `glosses` on the row (D-3). */
  gloss?: string;
  /** D-3: up to 2 meanings shown「・」-joined on the row (falls back to `gloss`). */
  glosses?: string[];
  stage: MasteryStage;
  due?: boolean;
  /** D-3: next-review timestamp — drives the dueAsc sort and the relative「今日/明日/M/D」label. */
  dueAt?: number;
  /** D-3: FSRS stability (days) for the stabilityAsc sort; undefined ⇒ New / never studied. */
  stability?: number;
  /** Known-word declaration (C-5d): suspended words live in their own「除外中」view. */
  suspended?: boolean;
}

/** D-3: row ordering. `dueAsc` (期限が近い順) is the default so today's work floats to the top. */
export type WordSort = 'dueAsc' | 'stabilityAsc' | 'abc';

const SORT_OPTIONS: { value: WordSort; label: string }[] = [
  { value: 'dueAsc', label: '期限が近い順' },
  { value: 'stabilityAsc', label: '記憶が弱い順' },
  { value: 'abc', label: 'ABC順' },
];

export interface WordbookScreenProps {
  words: WordbookEntry[];
  /** WordDetailCard renderer for the selected word (task 8.4), like ReadingScreen. */
  renderWordDetail?: (wordId: string, onClose: () => void) => ReactNode;
  /** 「もう覚えた（復習から外す）」: suspend a word from the row (C-5d). */
  onSuspend?: (wordId: string) => void | Promise<void>;
  /** 「復習に戻す」: restore a suspended word from the「除外中」view (C-5d). */
  onRestore?: (wordId: string) => void | Promise<void>;
  /**
   * A-3-2: weave the checked words into a new passage. Enables selection mode: a「選択」toggle
   * turns each row into a checkbox and a footer offers「選択した単語で文章を生成」.
   */
  onWeaveWords?: (wordIds: string[]) => void;
  /** C-5c: review only the checked words (footer「選択語を復習」→ /review?words=…). */
  onReviewWords?: (wordIds: string[]) => void;
  /** D-5: initial mastery/due filter (e.g. `/wordbook?filter=due` deep-links here). Default 'all'. */
  initialFilter?: WordbookFilter;
  /** D-3: initial sort (seeded from `?sort=`); default 'dueAsc'. */
  initialSort?: WordSort;
  /** D-3: persist the chosen sort (the route mirrors it to `?sort=`). */
  onSortChange?: (sort: WordSort) => void;
  /** Clock for the relative due labels (defaults to now). */
  now?: number;
}

export type WordbookFilter = MasteryStage | 'all' | 'due' | 'suspended';
type Filter = WordbookFilter;

const STAGE_JA: Record<MasteryStage, string> = {
  New: '未学習',
  Learning: '学習中',
  Consolidating: '定着',
  Mastered: '習熟',
};

const FILTERS: { value: Filter; label: string; stage?: MasteryStage }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'due', label: '要復習' },
  { value: 'New', label: '未学習', stage: 'New' },
  { value: 'Learning', label: '学習中', stage: 'Learning' },
  { value: 'Consolidating', label: '定着', stage: 'Consolidating' },
  { value: 'Mastered', label: '習熟', stage: 'Mastered' },
];

export function WordbookScreen({ words, renderWordDetail, onSuspend, onRestore, onWeaveWords, onReviewWords, initialFilter = 'all', initialSort = 'dueAsc', onSortChange, now = Date.now() }: WordbookScreenProps) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [sort, setSort] = useState<WordSort>(initialSort);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const changeSort = (next: WordSort): void => {
    setSort(next);
    onSortChange?.(next);
  };
  // A-3-2 / C-5c selection mode: a「選択」toggle turns rows into checkboxes; the footer weaves the
  // picked words into a passage or scopes a review to them. `picked` preserves selection order.
  const selectionEnabled = !!(onWeaveWords || onReviewWords);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggleSelectMode = (): void => {
    setSelectMode((on) => !on);
    setPicked(new Set());
  };
  const togglePick = (wordId: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  const pickedList = (): string[] => [...picked];

  const suspendedCount = useMemo(() => words.filter((w) => w.suspended).length, [words]);

  // D-3: per-filter counts so each chip shows the size of its slice (未学習 12 / 学習中 34…). Suspended
  // words are excluded from every bucket except their own「除外中」chip (counted via `suspendedCount`).
  const counts = useMemo(() => {
    const active = words.filter((w) => !w.suspended);
    const byStage = (stage: MasteryStage): number => active.filter((w) => w.stage === stage).length;
    return {
      all: active.length,
      due: active.filter((w) => w.due).length,
      New: byStage('New'),
      Learning: byStage('Learning'),
      Consolidating: byStage('Consolidating'),
      Mastered: byStage('Mastered'),
    } as const;
  }, [words]);

  const filterCount = (f: Filter): number | undefined => {
    if (f === 'suspended') return suspendedCount;
    if (f === 'all' || f === 'due') return counts[f];
    return counts[f];
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = words.filter((w) => {
      const isSuspended = !!w.suspended;
      // Suspended words are hidden from every view except the dedicated「除外中」filter (C-5d).
      if (filter === 'suspended') {
        if (!isSuspended) return false;
      } else if (isSuspended) {
        return false;
      } else if (filter === 'due') {
        if (!w.due) return false;
      } else if (filter !== 'all') {
        if (w.stage !== filter) return false;
      }
      if (!q) return true;
      const glossText = [...(w.glosses ?? []), w.gloss ?? ''].join(' ').toLowerCase();
      return w.headword.toLowerCase().includes(q) || glossText.includes(q);
    });
    // D-3: sort is applied after filtering. `dueAsc`/`stabilityAsc` push undefined (never-scheduled /
    // New) to the bottom via Infinity; Array.sort is stable so equal keys keep their incoming order.
    const key = (w: WordbookEntry): number =>
      sort === 'stabilityAsc' ? (w.stability ?? Infinity) : (w.dueAt ?? Infinity);
    if (sort === 'abc') return [...filtered].sort((a, b) => a.headword.localeCompare(b.headword));
    return [...filtered].sort((a, b) => key(a) - key(b));
  }, [words, filter, query, sort]);

  const closeDetail = (): void => setSelected(null);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div style={{ width: '100%', maxWidth: 780 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
          <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: 0 }}>単語帳</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {selectionEnabled ? (
              <button
                type="button"
                data-testid="wordbook-select-toggle"
                aria-pressed={selectMode}
                onClick={toggleSelectMode}
                style={selectToggleStyle(selectMode)}
              >
                {selectMode ? '選択をやめる' : '選択'}
              </button>
            ) : null}
            <span data-testid="wordbook-total" style={{ fontFamily: fonts.num, fontSize: 13, color: colors.muted }}>
              全 <span style={{ color: colors.ink, fontWeight: 600 }}>{words.length}</span> 語
            </span>
          </div>
        </div>

        {/* Controls: search + sort + mastery filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              aria-label="単語を検索"
              placeholder="単語・意味で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...searchInputStyle, flex: 1, minWidth: 180 }}
            />
            <select
              aria-label="並び替え"
              data-testid="wordbook-sort"
              value={sort}
              onChange={(e) => changeSort(e.target.value as WordSort)}
              style={sortSelectStyle}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FILTERS.map((f) => {
              const on = filter === f.value;
              const count = filterCount(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  data-testid={`filter-${f.value}`}
                  aria-pressed={on}
                  onClick={() => setFilter(f.value)}
                  style={filterChipStyle(on)}
                >
                  {f.stage ? (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: masteryColors[f.stage] }} />
                  ) : null}
                  {f.label}
                  {count !== undefined ? (
                    <span data-testid={`filter-count-${f.value}`} style={filterCountStyle(on)}>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {/* 「除外中」only appears once there is at least one suspended word (C-5d), so a clean
                wordbook keeps the default chip set. */}
            {suspendedCount > 0 ? (
              <button
                type="button"
                data-testid="filter-suspended"
                aria-pressed={filter === 'suspended'}
                onClick={() => setFilter('suspended')}
                style={filterChipStyle(filter === 'suspended')}
              >
                除外中 {suspendedCount}
              </button>
            ) : null}
          </div>
        </div>

        {/* List */}
        <div data-testid="wordbook-list" style={listCardStyle}>
          {visible.length === 0 ? (
            <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'center', padding: '36px 0' }}>
              該当する単語がありません
            </div>
          ) : (
            visible.map((w, i) => {
              const divider = i < visible.length - 1;
              const isSuspended = !!w.suspended;
              const isPicked = picked.has(w.wordId);
              // D-3: up to 2 meanings, ellipsised. Falls back to the legacy single `gloss`.
              const glossParts = w.glosses && w.glosses.length > 0 ? w.glosses : w.gloss ? [w.gloss] : [];
              const glossText = glossParts.slice(0, 2).join('・');
              return (
                <div key={w.wordId} data-testid={`word-item-${w.wordId}`} style={rowContainerStyle(divider)}>
                  <button
                    type="button"
                    className="interactive-row"
                    data-testid={`word-row-${w.wordId}`}
                    aria-pressed={selectMode ? isPicked : undefined}
                    onClick={() => (selectMode ? togglePick(w.wordId) : setSelected(w.wordId))}
                    style={rowMainStyle}
                  >
                    {selectMode ? (
                      <span aria-hidden style={checkboxStyle(isPicked)}>{isPicked ? '✓' : ''}</span>
                    ) : null}
                    <MasteryDot stage={w.stage} size={8} />
                    <span style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink, marginLeft: 11, flex: 'none' }}>{w.headword}</span>
                    {glossText ? (
                      <span style={glossStyle}>{glossText}</span>
                    ) : (
                      <span style={{ flex: 1, minWidth: 0 }} />
                    )}
                    {w.dueAt !== undefined ? (
                      <span
                        data-testid={`due-label-${w.wordId}`}
                        style={{ fontFamily: fonts.ui, fontSize: 11, marginRight: 8, flex: 'none', color: isDueToday(w.dueAt, now) && !isSuspended ? colors.terracotta : colors.muted }}
                      >
                        {dueLabel(w.dueAt, now)}
                      </span>
                    ) : w.due && !isSuspended ? (
                      <span style={dueBadgeStyle}>要復習</span>
                    ) : null}
                    <span style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.muted, flex: 'none' }}>{STAGE_JA[w.stage]}</span>
                  </button>
                  {/* Per-row suspend/restore is hidden in selection mode so the whole row is a clean
                      pick target. */}
                  {selectMode
                    ? null
                    : isSuspended
                      ? onRestore
                        ? (
                          <button
                            type="button"
                            data-testid={`restore-${w.wordId}`}
                            onClick={() => void onRestore(w.wordId)}
                            style={rowActionStyle}
                          >
                            復習に戻す
                          </button>
                        )
                        : null
                      : onSuspend
                        ? (
                          <button
                            type="button"
                            data-testid={`suspend-${w.wordId}`}
                            onClick={() => void onSuspend(w.wordId)}
                            style={rowActionStyle}
                          >
                            もう覚えた
                          </button>
                        )
                        : null}
                </div>
              );
            })
          )}
        </div>

        {selectMode ? (
          <div data-testid="wordbook-selection-footer" style={selectionFooterStyle}>
            <span style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.inkSoft }}>
              <span data-testid="wordbook-selected-count" style={{ color: colors.ink, fontWeight: 600 }}>{picked.size}</span> 語を選択中
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {onReviewWords ? (
                <button
                  type="button"
                  data-testid="wordbook-review-selected"
                  disabled={picked.size === 0}
                  onClick={() => onReviewWords(pickedList())}
                  style={selectionSecondaryButtonStyle(picked.size === 0)}
                >
                  選択語を復習 ({picked.size})
                </button>
              ) : null}
              {onWeaveWords ? (
                <button
                  type="button"
                  data-testid="wordbook-weave-selected"
                  disabled={picked.size === 0}
                  onClick={() => onWeaveWords(pickedList())}
                  style={selectionPrimaryButtonStyle(picked.size === 0)}
                >
                  選択した単語で文章を生成 ({picked.size})
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* D-3: the detail overlay is the shared accessible dialog (aria-modal + focus-trap + Escape +
          scroll-lock), not a hand-rolled backdrop. The panel is transparent so the WordDetailCard
          supplies its own surface/shadow at its own (wider) max width. */}
      {selected && renderWordDetail ? (
        <ModalOverlay onClose={closeDetail} label="単語詳細" panelStyle={detailPanelStyle}>
          {renderWordDetail(selected, closeDetail)}
        </ModalOverlay>
      ) : null}
    </div>
  );
}

const searchInputStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.ink,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '10px 14px',
};

const sortSelectStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.ink,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '10px 12px',
  flex: 'none',
  cursor: 'pointer',
};

const filterChipStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontFamily: fonts.ui,
  fontSize: 13,
  color: on ? '#fff' : colors.inkSoft,
  background: on ? colors.primary : '#F1F4F8',
  border: on ? '1px solid transparent' : `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '6px 13px',
  cursor: 'pointer',
});

const filterCountStyle = (on: boolean): CSSProperties => ({
  fontFamily: fonts.num,
  fontSize: 11,
  fontWeight: 600,
  color: on ? '#fff' : colors.muted,
  opacity: on ? 0.85 : 1,
});

const glossStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.faint,
  marginLeft: 10,
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const selectToggleStyle = (on: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: on ? '#fff' : colors.primary,
  background: on ? colors.primary : colors.surfaceCard,
  border: `1px solid ${on ? 'transparent' : colors.primary}`,
  borderRadius: radius.chip,
  padding: '6px 15px',
  cursor: 'pointer',
});

const checkboxStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  marginRight: 11,
  flex: 'none',
  fontSize: 12,
  lineHeight: 1,
  color: '#fff',
  background: on ? colors.primary : colors.surfaceCard,
  border: `1.5px solid ${on ? colors.primary : colors.borderControl}`,
  borderRadius: 5,
});

const selectionFooterStyle: CSSProperties = {
  position: 'sticky',
  bottom: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 16,
  padding: '12px 16px',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  boxShadow: shadow.card,
};

const selectionPrimaryButtonStyle = (disabled: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: disabled ? colors.borderControl : colors.primary,
  border: '1px solid transparent',
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const selectionSecondaryButtonStyle = (disabled: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: disabled ? colors.faint : colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${disabled ? colors.borderControl : colors.primary}`,
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const listCardStyle: CSSProperties = {
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '6px 18px',
};

const rowContainerStyle = (divider: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  gap: 8,
  borderBottom: divider ? `1px solid ${colors.dividerRow}` : 'none',
  // D-3: keep a 1000-word list smooth by letting the browser skip off-screen row layout/paint.
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 44px',
});

const rowMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
  gap: 0,
  padding: '11px 0',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};

const rowActionStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.muted,
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '5px 10px',
  cursor: 'pointer',
};

const dueBadgeStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  fontWeight: 600,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.chip,
  padding: '3px 8px',
  marginRight: 8,
};

// D-3: the ModalOverlay panel is transparent — the WordDetailCard carries its own surface/shadow at
// its own (wider, 780px) max width, so the panel only needs to stop clipping and center it.
const detailPanelStyle: CSSProperties = {
  maxWidth: 'min(780px, 100%)',
  maxHeight: 'none',
  width: '100%',
  background: 'transparent',
  boxShadow: 'none',
  borderRadius: 0,
  // The WordDetailCard scrolls internally (maxHeight 90vh); the panel must not add a second scroller.
  overflowY: 'visible',
};

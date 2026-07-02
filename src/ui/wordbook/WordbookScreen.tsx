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
import { masteryColors, colors, fonts, radius } from '../theme/tokens';
import type { MasteryStage } from '../../types/domain';

export interface WordbookEntry {
  wordId: string;
  headword: string;
  gloss?: string;
  stage: MasteryStage;
}

export interface WordbookScreenProps {
  words: WordbookEntry[];
  /** WordDetailCard renderer for the selected word (task 8.4), like ReadingScreen. */
  renderWordDetail?: (wordId: string, onClose: () => void) => ReactNode;
}

type Filter = MasteryStage | 'all';

const STAGE_JA: Record<MasteryStage, string> = {
  New: '未学習',
  Learning: '学習中',
  Consolidating: '定着',
  Mastered: '習熟',
};

const FILTERS: { value: Filter; label: string; stage?: MasteryStage }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'New', label: '未学習', stage: 'New' },
  { value: 'Learning', label: '学習中', stage: 'Learning' },
  { value: 'Consolidating', label: '定着', stage: 'Consolidating' },
  { value: 'Mastered', label: '習熟', stage: 'Mastered' },
];

export function WordbookScreen({ words, renderWordDetail }: WordbookScreenProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      if (filter !== 'all' && w.stage !== filter) return false;
      if (!q) return true;
      return w.headword.toLowerCase().includes(q) || (w.gloss ?? '').toLowerCase().includes(q);
    });
  }, [words, filter, query]);

  const closeDetail = (): void => setSelected(null);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div style={{ width: '100%', maxWidth: 780 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: 0 }}>単語帳</h1>
          <span data-testid="wordbook-total" style={{ fontFamily: fonts.num, fontSize: 13, color: colors.muted }}>
            全 <span style={{ color: colors.ink, fontWeight: 600 }}>{words.length}</span> 語
          </span>
        </div>

        {/* Controls: search + mastery filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
          <input
            aria-label="単語を検索"
            placeholder="単語・意味で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={searchInputStyle}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FILTERS.map((f) => {
              const on = filter === f.value;
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
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div data-testid="wordbook-list" style={listCardStyle}>
          {visible.length === 0 ? (
            <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'center', padding: '36px 0' }}>
              該当する単語がありません
            </div>
          ) : (
            visible.map((w, i) => (
              <button
                key={w.wordId}
                type="button"
                data-testid={`word-row-${w.wordId}`}
                onClick={() => setSelected(w.wordId)}
                style={rowStyle(i < visible.length - 1)}
              >
                <MasteryDot stage={w.stage} size={8} />
                <span style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink, marginLeft: 11 }}>{w.headword}</span>
                {w.gloss ? (
                  <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginLeft: 10, flex: 1, textAlign: 'left' }}>
                    {w.gloss}
                  </span>
                ) : (
                  <span style={{ flex: 1 }} />
                )}
                <span style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.muted }}>{STAGE_JA[w.stage]}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {selected && renderWordDetail ? (
        <div
          role="dialog"
          aria-label="単語詳細"
          style={detailOverlayStyle}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          {renderWordDetail(selected, closeDetail)}
        </div>
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

const listCardStyle: CSSProperties = {
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '6px 18px',
};

const rowStyle = (divider: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  gap: 0,
  padding: '11px 0',
  background: 'transparent',
  border: 'none',
  borderBottom: divider ? `1px solid ${colors.dividerRow}` : 'none',
  cursor: 'pointer',
});

const detailOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(25,40,65,.28)',
  padding: 20,
  zIndex: 40,
};

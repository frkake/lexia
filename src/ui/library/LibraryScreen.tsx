/**
 * L4 — LibraryScreen: the "文章" tab. All stored passages with a ranked search box. Standalone
 * articles link to /p/:id; story chapters collapse into one directory row that links to /s/:id.
 * Presentational: passages + story titles are injected; navigation is delegated via callbacks.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { passageSearch, INTENT_LABELS } from '../../domain/library/passageSearch';
import type { LibraryEntry } from '../../domain/library/passageSearch';
import type { PassageRecord } from '../../types/ports';

export interface LibraryScreenProps {
  passages: PassageRecord[];
  storyTitles?: Record<string, string>;
  onOpenArticle?: (passageId: string) => void;
  onOpenStory?: (storyId: string) => void;
}

export function LibraryScreen({ passages, storyTitles = {}, onOpenArticle, onOpenStory }: LibraryScreenProps) {
  const [query, setQuery] = useState('');
  const results = useMemo<LibraryEntry[]>(
    () => passageSearch(passages, query, storyTitles),
    [passages, query, storyTitles],
  );
  const isSearching = query.trim().length > 0;

  return (
    <div style={pageStyle} className="library-page">
      <div style={{ width: '100%', maxWidth: 760 }}>
        <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: '0 0 4px' }}>
          文章
        </h1>
        <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginBottom: 20 }}>
          生成した記事と物語をまとめて探せます。
        </div>

        <input
          type="search"
          aria-label="文章を検索"
          placeholder="タイトル・テーマ・本文で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={searchStyle}
        />

        {results.length === 0 ? (
          <div style={emptyStyle}>
            {isSearching ? '該当する文章がありません' : 'まだ文章がありません。ホームで最初の文章を生成しましょう。'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 18 }}>
            {results.map((entry) =>
              entry.kind === 'article' ? (
                <button
                  key={entry.passage.passageId}
                  type="button"
                  onClick={() => onOpenArticle?.(entry.passage.passageId)}
                  style={rowStyle}
                >
                  <span style={titleStyle}>{entry.passage.passage.meta.title}</span>
                  <span style={metaStyle}>
                    {INTENT_LABELS[entry.passage.passage.meta.intent]} · {entry.passage.passage.meta.level}
                  </span>
                </button>
              ) : (
                <button
                  key={entry.storyId}
                  type="button"
                  onClick={() => onOpenStory?.(entry.storyId)}
                  style={rowStyle}
                >
                  <span style={titleStyle}>
                    <span aria-hidden style={{ color: colors.primary, marginRight: 8 }}>
                      ▸
                    </span>
                    {entry.title}
                  </span>
                  <span style={metaStyle}>物語 · 全{entry.chapterCount}章</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  background: colors.surfacePage,
  padding: '40px 24px',
  minHeight: '100%',
};

const searchStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: fonts.ui,
  fontSize: 15,
  color: colors.ink,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '12px 14px',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 16,
  width: '100%',
  textAlign: 'left',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '16px 18px',
  cursor: 'pointer',
};

const titleStyle: CSSProperties = { fontFamily: fonts.serifJp, fontSize: 17, color: colors.ink };
const metaStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 12, color: colors.faint, flex: 'none' };

const emptyStyle: CSSProperties = {
  marginTop: 40,
  textAlign: 'center',
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.faint,
};

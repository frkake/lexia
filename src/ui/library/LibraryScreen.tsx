/**
 * L4 — LibraryScreen: the "文章" tab. All stored passages with a ranked search box. Standalone
 * articles link to /p/:id; story chapters collapse into one directory row that links to /s/:id.
 * Presentational: passages + story titles are injected; navigation is delegated via callbacks.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { AssetImage } from '../shared/AssetImage';
import { passageSearch, INTENT_LABELS } from '../../domain/library/passageSearch';
import type { LibraryEntry } from '../../domain/library/passageSearch';
import type { PassageRecord } from '../../types/ports';
import type { PassageMeta, ReadingProgress } from '../../types/domain';

export interface LibraryScreenProps {
  passages: PassageRecord[];
  storyTitles?: Record<string, string>;
  /** D-4: reading progress by passageId (article → its id, story → its latest chapter id). */
  progress?: Record<string, ReadingProgress>;
  onOpenArticle?: (passageId: string) => void;
  onOpenStory?: (storyId: string) => void;
}

/** D-4: 作成日を M/D で表示。 */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * D-4: 96×64 thumbnail — prefers the passage's downscaled `sceneThumbnailUrl` (D-4 第2段), falls back
 * to the full-size `sceneIllustrationUrl`, else a category-tinted initial placeholder. `AssetImage`
 * resolves a `lexia-image:` ref (D7) to an object URL and passes plain data/http URLs straight through.
 */
function Thumbnail({ src, initial, kind }: { src?: string; initial: string; kind: 'article' | 'story' }) {
  if (src) {
    return <AssetImage src={src} alt="" aria-hidden style={thumbImageStyle} />;
  }
  const tint = kind === 'story' ? { bg: colors.greenBg, fg: colors.greenDeep } : { bg: colors.surfaceBlue, fg: colors.primary };
  return (
    <div aria-hidden style={{ ...thumbPlaceholderStyle, background: tint.bg, color: tint.fg }}>
      {initial}
    </div>
  );
}

/** D-4: read-state marker — 読了✓ / {percent}% (続きから強調) / 未読. */
function StatusMarker({ progress }: { progress?: ReadingProgress }) {
  if (progress?.status === 'completed') {
    return <span data-testid="status-completed" style={statusDoneStyle}>読了 ✓</span>;
  }
  if (progress?.status === 'in_progress') {
    return (
      <span data-testid="status-progress" style={statusProgressStyle}>
        続きから {progress.percent}%
      </span>
    );
  }
  return <span data-testid="status-unread" style={statusUnreadStyle}>未読</span>;
}

/** D-4: an article/story card — thumbnail + title + meta + read-state, one shared shape. */
function LibraryCard({
  kind,
  title,
  thumbSrc,
  meta,
  badge,
  progress,
  onOpen,
}: {
  kind: 'article' | 'story';
  title: string;
  thumbSrc?: string;
  meta: string;
  badge?: string;
  progress?: ReadingProgress;
  onOpen: () => void;
}) {
  const initial = title.trim().charAt(0).toUpperCase() || '?';
  return (
    <button type="button" className="interactive-row" onClick={onOpen} style={cardStyle(progress?.status === 'in_progress')}>
      <Thumbnail src={thumbSrc} initial={initial} kind={kind} />
      <div style={cardBodyStyle}>
        <div style={cardTitleRowStyle}>
          <span style={titleStyle}>{title}</span>
          {badge ? <span style={storyBadgeStyle}>{badge}</span> : null}
        </div>
        <span style={metaStyle}>{meta}</span>
      </div>
      <StatusMarker progress={progress} />
    </button>
  );
}

/** D-4: article meta line —「INTENT · CEFR · N語 · M/D」. */
function articleMeta(meta: PassageMeta, createdAt: number): string {
  return [INTENT_LABELS[meta.intent], meta.level, `${meta.approxWords}語`, shortDate(createdAt)].join(' · ');
}

export function LibraryScreen({ passages, storyTitles = {}, progress = {}, onOpenArticle, onOpenStory }: LibraryScreenProps) {
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
            {results.map((entry) =>
              entry.kind === 'article' ? (
                <LibraryCard
                  key={entry.passage.passageId}
                  kind="article"
                  title={entry.passage.passage.meta.title}
                  thumbSrc={entry.passage.passage.meta.sceneThumbnailUrl ?? entry.passage.passage.meta.sceneIllustrationUrl}
                  meta={articleMeta(entry.passage.passage.meta, entry.passage.createdAt)}
                  progress={progress[entry.passage.passageId]}
                  onOpen={() => onOpenArticle?.(entry.passage.passageId)}
                />
              ) : (
                <LibraryCard
                  key={entry.storyId}
                  kind="story"
                  title={entry.title}
                  thumbSrc={entry.latest.passage.meta.sceneThumbnailUrl ?? entry.latest.passage.meta.sceneIllustrationUrl}
                  meta={[INTENT_LABELS[entry.latest.passage.meta.intent], entry.latest.passage.meta.level, shortDate(entry.latest.createdAt)].join(' · ')}
                  badge={`物語 · 全${entry.chapterCount}章`}
                  progress={progress[entry.latest.passageId]}
                  onOpen={() => onOpenStory?.(entry.storyId)}
                />
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

// D-4: card row — left thumbnail, title/meta body, right read-state. in_progress gets a primary
// left accent border so「続きから」cards stand out. `content-visibility` keeps a 100-item list smooth.
const cardStyle = (inProgress: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  textAlign: 'left',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderLeft: inProgress ? `3px solid ${colors.primary}` : `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '12px 16px',
  cursor: 'pointer',
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 76px',
});

const thumbBaseStyle: CSSProperties = {
  width: 96,
  height: 64,
  flex: 'none',
  borderRadius: 8,
  overflow: 'hidden',
};

const thumbImageStyle: CSSProperties = {
  ...thumbBaseStyle,
  objectFit: 'cover',
  display: 'block',
  background: colors.surfaceSubtle,
};

const thumbPlaceholderStyle: CSSProperties = {
  ...thumbBaseStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: fonts.serif,
  fontSize: 26,
  fontWeight: 600,
};

const cardBodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const cardTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const titleStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 17,
  color: colors.ink,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
};
const metaStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 12, color: colors.faint };

const storyBadgeStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  borderRadius: radius.chip,
  padding: '2px 8px',
};

const statusBaseStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
};

const statusDoneStyle: CSSProperties = { ...statusBaseStyle, color: colors.green };
const statusProgressStyle: CSSProperties = { ...statusBaseStyle, color: colors.primary };
const statusUnreadStyle: CSSProperties = { ...statusBaseStyle, color: colors.faint, fontWeight: 400 };

const emptyStyle: CSSProperties = {
  marginTop: 40,
  textAlign: 'center',
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.faint,
};

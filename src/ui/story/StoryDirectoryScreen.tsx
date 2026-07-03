/**
 * L4 — StoryDirectoryScreen: the story "folder" (/s/:storyId). Title + synopsis + character cards +
 * chapter list. Generated chapters link into the reader (/s/:storyId/:chapterIndex); planned-but-
 * ungenerated chapters are shown disabled. Presentational: the plan + per-chapter generated flags
 * are injected; navigation is delegated via onOpenChapter.
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { StoryPlan } from '../../types/domain';

export interface StoryChapterRow {
  chapterIndex: number;
  headingJa: string;
  generated: boolean;
}

export interface StoryDirectoryScreenProps {
  plan: StoryPlan;
  chapters: StoryChapterRow[];
  onOpenChapter?: (chapterIndex: number) => void;
}

export function StoryDirectoryScreen({ plan, chapters, onOpenChapter }: StoryDirectoryScreenProps) {
  return (
    <div style={pageStyle} className="story-directory-page">
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, letterSpacing: '.04em', color: colors.primary }}>
          物語 / STORY
        </div>
        <h1 style={{ fontFamily: fonts.serifJp, fontSize: 28, fontWeight: 500, color: colors.ink, margin: '6px 0 10px' }}>
          {plan.titleJa}
        </h1>
        <p style={{ fontFamily: fonts.bodyJp, fontSize: 14, color: colors.body, lineHeight: 1.7, margin: 0 }}>
          {plan.synopsisJa}
        </p>

        {plan.characters.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <div style={sectionTitleStyle}>登場人物</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              {plan.characters.map((ch) => (
                <div key={ch.name} style={characterCardStyle}>
                  {ch.illustrationUrl ? (
                    <img src={ch.illustrationUrl} alt={ch.name} style={portraitStyle} />
                  ) : (
                    <div aria-hidden style={{ ...portraitStyle, background: colors.avatarBg }} />
                  )}
                  <div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>{ch.name}</div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{ch.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginTop: 28 }}>
          <div style={sectionTitleStyle}>章の一覧</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
            {chapters.map((row) =>
              row.generated ? (
                <button
                  key={row.chapterIndex}
                  type="button"
                  onClick={() => onOpenChapter?.(row.chapterIndex)}
                  style={chapterRowStyle(true)}
                >
                  <span style={{ fontFamily: fonts.serifJp, fontSize: 16, color: colors.ink }}>{row.headingJa}</span>
                  <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.primary }}>読む</span>
                </button>
              ) : (
                <div key={row.chapterIndex} style={chapterRowStyle(false)}>
                  <span style={{ fontFamily: fonts.serifJp, fontSize: 16, color: colors.faint }}>{row.headingJa}</span>
                  <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>未生成</span>
                </div>
              ),
            )}
          </div>
        </section>
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

const sectionTitleStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink };

const characterCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '12px 16px',
  minWidth: 200,
};

const portraitStyle: CSSProperties = {
  width: 44,
  height: 66,
  borderRadius: radius.control,
  objectFit: 'contain',
  flex: 'none',
  background: colors.avatarBg,
};

const chapterRowStyle = (generated: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  width: '100%',
  textAlign: 'left',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '14px 18px',
  cursor: generated ? 'pointer' : 'default',
});

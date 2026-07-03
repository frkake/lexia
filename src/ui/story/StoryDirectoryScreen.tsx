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
  onRegenerateCharacter?: (characterIndex: number) => void;
  regeneratingCharacterIndex?: number | null;
  characterIllustrationError?: string | null;
}

export function StoryDirectoryScreen({
  plan,
  chapters,
  onOpenChapter,
  onRegenerateCharacter,
  regeneratingCharacterIndex = null,
  characterIllustrationError = null,
}: StoryDirectoryScreenProps) {
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
              {plan.characters.map((ch, index) => (
                <div key={ch.name} style={characterCardStyle}>
                  {ch.illustrationUrl ? (
                    <img src={ch.illustrationUrl} alt={ch.name} style={portraitStyle} />
                  ) : (
                    <div aria-hidden style={{ ...portraitStyle, background: colors.avatarBg }} />
                  )}
                  <div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>{ch.name}</div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{ch.role}</div>
                    {onRegenerateCharacter ? (
                      <button
                        type="button"
                        data-testid={`regenerate-directory-character-${index}`}
                        onClick={() => onRegenerateCharacter(index)}
                        disabled={regeneratingCharacterIndex !== null}
                        aria-busy={regeneratingCharacterIndex === index}
                        style={characterRegenerateButtonStyle(regeneratingCharacterIndex === index)}
                      >
                        {regeneratingCharacterIndex === index ? '生成中…' : 'イラストを再生成'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {characterIllustrationError ? (
              <div role="alert" style={errorStyle}>
                {characterIllustrationError}
              </div>
            ) : null}
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

const characterRegenerateButtonStyle = (busy: boolean): CSSProperties => ({
  marginTop: 7,
  fontFamily: fonts.ui,
  fontSize: 11.5,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '6px 9px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.68 : 1,
});

const errorStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '8px 11px',
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

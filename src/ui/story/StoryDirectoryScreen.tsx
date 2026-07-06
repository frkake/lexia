/**
 * L4 — StoryDirectoryScreen: the story "folder" (/s/:storyId). Title + synopsis + character cards +
 * chapter list. Generated chapters link into the reader (/s/:storyId/:chapterIndex); planned-but-
 * ungenerated chapters are shown disabled. Presentational: the plan + per-chapter generated flags
 * are injected; navigation is delegated via onOpenChapter.
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { AssetImage } from '../shared/AssetImage';
import type { StoryCharacter, StoryPlan } from '../../types/domain';

export interface StoryChapterRow {
  chapterIndex: number;
  headingJa: string;
  generated: boolean;
}

export interface StoryDirectoryScreenProps {
  plan: StoryPlan;
  chapters: StoryChapterRow[];
  onOpenChapter?: (chapterIndex: number) => void;
  onOpenCharacter?: (characterIndex: number) => void;
  onRegenerateCharacter?: (characterIndex: number) => void;
  regeneratingCharacterIndex?: number | null;
  characterIllustrationError?: string | null;
}

export function StoryDirectoryScreen({
  plan,
  chapters,
  onOpenChapter,
  onOpenCharacter,
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
                <article key={ch.name} style={characterCardStyle}>
                  {onOpenCharacter ? (
                    <button
                      type="button"
                      data-testid={`open-directory-character-${index}`}
                      aria-label={`${ch.name} の詳細`}
                      onClick={() => onOpenCharacter(index)}
                      style={characterOpenButtonStyle}
                    >
                      <CharacterPortrait character={ch} />
                    </button>
                  ) : (
                    <div style={characterOpenStaticStyle}>
                      <CharacterPortrait character={ch} />
                    </div>
                  )}
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
                </article>
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

function CharacterPortrait({ character }: { character: StoryCharacter }) {
  const url = portraitImageUrl(character);
  return (
    <>
      {url ? (
        <AssetImage src={url} alt={character.name} style={portraitStyle} />
      ) : (
        <div aria-hidden style={{ ...portraitStyle, background: colors.avatarBg }} />
      )}
      <span style={characterTextStyle}>
        <span style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>{character.name}</span>
        <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{character.role}</span>
      </span>
    </>
  );
}

function portraitImageUrl(character: StoryCharacter): string | undefined {
  const portraitUrl = character.portraitIllustrationUrl ?? character.illustrationUrl;
  if (!portraitUrl) return undefined;
  if (character.fullBodyIllustrationUrl && portraitUrl === character.fullBodyIllustrationUrl) return undefined;
  return portraitUrl;
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
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: 12,
  minWidth: 220,
};

const characterOpenButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: 0,
  textAlign: 'left',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};

const characterOpenStaticStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const characterTextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const portraitStyle: CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: radius.control,
  objectFit: 'contain',
  objectPosition: 'center top',
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

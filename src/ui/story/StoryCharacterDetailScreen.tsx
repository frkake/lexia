/**
 * L4 — StoryCharacterDetailScreen: individual character page under a story. The story directory
 * uses portrait thumbnails; this page gives the character a full-body view and profile context.
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { StoryCharacter, StoryPlan } from '../../types/domain';

export interface StoryCharacterDetailScreenProps {
  plan: StoryPlan;
  characterIndex: number;
  onBack?: () => void;
  onDescriptionChange?: (descriptionJa: string) => void;
  onRegenerateFullBody?: () => void;
  regeneratingFullBody?: boolean;
  illustrationError?: string | null;
}

export function StoryCharacterDetailScreen({
  plan,
  characterIndex,
  onBack,
  onDescriptionChange,
  onRegenerateFullBody,
  regeneratingFullBody = false,
  illustrationError = null,
}: StoryCharacterDetailScreenProps) {
  const character = plan.characters[characterIndex];
  if (!character) return null;
  const fullBodyUrl = fullBodyImageUrl(character);

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div style={topLineStyle}>
          <button type="button" onClick={onBack} style={backButtonStyle}>
            物語へ戻る
          </button>
          <span style={storyTitleStyle}>{plan.titleJa}</span>
        </div>

        <div style={profileGridStyle}>
          <div style={imageStageStyle}>
            {fullBodyUrl ? (
              <img src={fullBodyUrl} alt={`${character.name} の全身`} style={fullBodyImageStyle} />
            ) : regeneratingFullBody ? (
              <div data-testid="character-full-body-loading" aria-hidden="true" style={fullBodyLoadingStyle} />
            ) : (
              <div data-testid="character-full-body-placeholder" aria-hidden="true" style={fullBodyPlaceholderStyle}>
                {[...character.name][0] ?? '?'}
              </div>
            )}
          </div>

          <section style={detailStyle}>
            <div style={eyebrowStyle}>人物 / CHARACTER</div>
            <h1 style={nameStyle}>{character.name}</h1>
            <div style={roleStyle}>{character.role}</div>
            {onDescriptionChange ? (
              <label style={descriptionEditWrapStyle}>
                <span style={descriptionLabelStyle}>キャラクター説明</span>
                <textarea
                  aria-label={`${character.name}の説明`}
                  value={character.descriptionJa}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  rows={6}
                  style={descriptionTextareaStyle}
                />
              </label>
            ) : (
              <p style={descriptionStyle}>{character.descriptionJa}</p>
            )}
            {onRegenerateFullBody ? (
              <button
                type="button"
                data-testid="regenerate-character-full-body"
                onClick={onRegenerateFullBody}
                disabled={regeneratingFullBody}
                aria-busy={regeneratingFullBody}
                style={regenerateButtonStyle(regeneratingFullBody)}
              >
                {regeneratingFullBody ? '生成中…' : '全身イラストを再生成'}
              </button>
            ) : null}
            {illustrationError ? (
              <div role="alert" style={errorStyle}>
                {illustrationError}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export function fullBodyImageUrl(character: StoryCharacter): string | undefined {
  return character.fullBodyIllustrationUrl;
}

const pageStyle: CSSProperties = {
  minHeight: '100%',
  background: colors.surfacePage,
  padding: '32px 24px 48px',
};

const shellStyle: CSSProperties = {
  width: '100%',
  maxWidth: 980,
  margin: '0 auto',
};

const topLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 22,
};

const backButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 700,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '8px 11px',
  cursor: 'pointer',
};

const storyTitleStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 15,
  color: colors.inkSoft,
  minWidth: 0,
};

const profileGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: 34,
  alignItems: 'center',
};

const imageStageStyle: CSSProperties = {
  minHeight: 'min(560px, 72vh)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: 22,
};

const fullBodyImageStyle: CSSProperties = {
  width: '100%',
  maxHeight: 620,
  objectFit: 'contain',
};

const fullBodyLoadingStyle: CSSProperties = {
  width: '72%',
  maxWidth: 300,
  aspectRatio: '3 / 4',
  borderRadius: radius.card,
  background: `linear-gradient(100deg, ${colors.surfaceSubtle}, ${colors.highlight}, ${colors.surfaceSubtle})`,
};

const fullBodyPlaceholderStyle: CSSProperties = {
  width: '72%',
  maxWidth: 300,
  aspectRatio: '3 / 4',
  borderRadius: radius.card,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: fonts.serif,
  fontSize: 72,
  color: colors.faint,
  background: colors.avatarBg,
};

const detailStyle: CSSProperties = {
  minWidth: 0,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: colors.primary,
};

const nameStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 38,
  fontWeight: 500,
  color: colors.ink,
  margin: '8px 0 6px',
};

const roleStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  fontWeight: 700,
  color: colors.inkSoft,
};

const descriptionStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 15,
  lineHeight: 1.8,
  color: colors.body,
  margin: '22px 0 0',
};

const descriptionEditWrapStyle: CSSProperties = {
  display: 'block',
  marginTop: 22,
};

const descriptionLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 700,
  color: colors.ink,
  marginBottom: 6,
};

const descriptionTextareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: fonts.bodyJp,
  fontSize: 14,
  lineHeight: 1.7,
  color: colors.body,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '10px 12px',
  resize: 'vertical',
};

const regenerateButtonStyle = (busy: boolean): CSSProperties => ({
  marginTop: 24,
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 700,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '9px 12px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.68 : 1,
});

const errorStyle: CSSProperties = {
  marginTop: 12,
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '8px 11px',
};

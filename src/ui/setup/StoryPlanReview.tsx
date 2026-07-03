/**
 * L4 — StoryPlanReview (Requirement 6.3). Presents the generated story plan (characters + plot)
 * for the learner to review and lightly edit (title / synopsis), then confirm. Confirmation is the
 * GATE to body generation: `onConfirm` fires only on the explicit action, never on mount, so no
 * chapter is generated until the learner accepts the plan. Purely presentational; StoryPlanner owns
 * generation and (post-confirm) persistence.
 */

import { useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { StoryCharacter, StoryPlan } from '../../types/domain';

export interface StoryPlanReviewProps {
  plan: StoryPlan;
  /** Fires with the (possibly edited) plan when the learner confirms — the body-generation gate. */
  onConfirm: (plan: StoryPlan) => void;
  /** Optional: discard this plan and regenerate. */
  onCancel?: () => void;
  /** True while the confirmed plan is being turned into the first chapter. */
  confirming?: boolean;
  /** Body-generation error shown on the confirmation gate. */
  confirmError?: string | null;
  /** Optional on-demand portrait refresh for a single character. */
  onRegenerateCharacter?: (characterIndex: number) => void;
  regeneratingCharacterIndex?: number | null;
  characterIllustrationError?: string | null;
  /**
   * True while character portraits are still being generated (6.8). Characters without an
   * illustrationUrl show a loading skeleton; once illustration settles they fall back to a monogram
   * placeholder. Illustration is enrichment — it never blocks the confirm button.
   */
  illustrating?: boolean;
}

export function StoryPlanReview({
  plan,
  onConfirm,
  onCancel,
  confirming = false,
  confirmError = null,
  onRegenerateCharacter,
  regeneratingCharacterIndex = null,
  characterIllustrationError = null,
  illustrating = false,
}: StoryPlanReviewProps) {
  const [titleJa, setTitleJa] = useState(plan.titleJa);
  const [synopsisJa, setSynopsisJa] = useState(plan.synopsisJa);

  const confirm = (): void => {
    if (confirming) return;
    onConfirm({ ...plan, titleJa, synopsisJa });
  };

  return (
    <div style={cardStyle}>
      <div style={{ padding: '28px 34px 20px' }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          キャラクター設定・物語全体の概要・プロットを確認してください。確定すると本文の執筆を始めます。
        </div>
        <label style={fieldLabelStyle} htmlFor="story-title">
          タイトル
        </label>
        <input id="story-title" aria-label="タイトル" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} style={inputStyle} />
        <div style={{ marginTop: 6, fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>{titleJa}</div>
      </div>

      <div style={{ padding: '0 34px 8px' }}>
        <label style={fieldLabelStyle} htmlFor="story-synopsis">
          物語全体の概要
        </label>
        <textarea
          id="story-synopsis"
          aria-label="物語全体の概要"
          value={synopsisJa}
          onChange={(e) => setSynopsisJa(e.target.value)}
          rows={3}
          style={textareaStyle}
        />
      </div>

      <div style={{ padding: '8px 34px' }}>
        <div style={sectionLabelStyle}>キャラクター設定</div>
        <div style={characterGridStyle}>
          {plan.characters.map((ch, index) => (
            <div key={ch.name} style={characterCardStyle}>
              <CharacterPortrait character={ch} illustrating={illustrating} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: fonts.serif, fontWeight: 600, color: colors.ink }}>{ch.name}</span>
                <span style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{ch.role}</span>
                <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{ch.descriptionJa}</span>
                {onRegenerateCharacter ? (
                  <button
                    type="button"
                    data-testid={`regenerate-character-portrait-${index}`}
                    onClick={() => onRegenerateCharacter(index)}
                    disabled={illustrating || regeneratingCharacterIndex !== null}
                    aria-busy={regeneratingCharacterIndex === index}
                    style={portraitRegenerateButtonStyle(regeneratingCharacterIndex === index)}
                  >
                    {regeneratingCharacterIndex === index ? '生成中…' : 'イラストを再生成'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {characterIllustrationError ? (
          <div role="alert" style={{ ...errorStyle, marginTop: 9 }}>
            {characterIllustrationError}
          </div>
        ) : null}
      </div>

      <div style={{ padding: '8px 34px 20px' }}>
        <div style={sectionLabelStyle}>プロット</div>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {plan.chapters.map((c) => (
            <li key={c.index} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.inkSoft, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{c.headingJa}</span>
              {c.beatJa ? <span style={{ color: colors.faint }}> — {c.beatJa}</span> : null}
            </li>
          ))}
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '12px 34px 28px' }}>
        {confirmError ? (
          <div role="alert" style={errorStyle}>
            {confirmError}
          </div>
        ) : null}
        <button
          type="button"
          onClick={confirm}
          disabled={confirming}
          aria-busy={confirming}
          style={confirmButtonStyle(confirming)}
        >
          {confirming ? '執筆しています…' : 'この設定で執筆する'}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={confirming} style={cancelButtonStyle(confirming)}>
            やり直す
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A character's portrait (6.8): the generated illustration when present; a loading skeleton while
 * illustration is still in progress; otherwise a monogram placeholder. Enrichment only — never gates
 * the flow.
 */
function CharacterPortrait({ character, illustrating }: { character: StoryCharacter; illustrating: boolean }) {
  if (character.illustrationUrl) {
    return <img src={character.illustrationUrl} alt={character.name} style={portraitImageStyle} />;
  }
  if (illustrating) {
    return <div data-testid="character-portrait-loading" style={portraitSkeletonStyle} aria-hidden="true" />;
  }
  const monogram = [...character.name][0] ?? '?';
  return (
    <div data-testid="character-portrait-placeholder" style={portraitPlaceholderStyle} aria-hidden="true">
      {monogram}
    </div>
  );
}

const PORTRAIT_SIZE = 56;
const PORTRAIT_HEIGHT = 84;

const portraitImageStyle: CSSProperties = {
  width: PORTRAIT_SIZE,
  height: PORTRAIT_HEIGHT,
  borderRadius: radius.control,
  objectFit: 'contain',
  flexShrink: 0,
  background: colors.surfaceSubtle,
};

const portraitSkeletonStyle: CSSProperties = {
  width: PORTRAIT_SIZE,
  height: PORTRAIT_HEIGHT,
  borderRadius: radius.control,
  flexShrink: 0,
  background: `linear-gradient(90deg, ${colors.surfaceSubtle}, ${colors.borderControl}, ${colors.surfaceSubtle})`,
};

const portraitPlaceholderStyle: CSSProperties = {
  width: PORTRAIT_SIZE,
  height: PORTRAIT_HEIGHT,
  borderRadius: radius.control,
  flexShrink: 0,
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderControl}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: fonts.serif,
  fontSize: 22,
  fontWeight: 600,
  color: colors.muted,
};

const portraitRegenerateButtonStyle = (busy: boolean): CSSProperties => ({
  alignSelf: 'flex-start',
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

const characterGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 8,
};

const characterCardStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '10px 12px',
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
  background: colors.surfaceCard,
  borderRadius: radius.card,
  boxShadow: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  overflow: 'hidden',
};

const fieldLabelStyle: CSSProperties = { display: 'block', fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.ink, marginBottom: 5 };
const sectionLabelStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.ink, marginBottom: 8 };

const inputStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 14,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '8px 12px',
  width: '100%',
  boxSizing: 'border-box',
};

const textareaStyle: CSSProperties = { ...inputStyle, fontFamily: fonts.ui, resize: 'vertical' };

const errorStyle: CSSProperties = {
  flexBasis: '100%',
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '8px 11px',
};

const confirmButtonStyle = (busy: boolean): CSSProperties => ({
  flex: 1,
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.card,
  padding: 13,
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.72 : 1,
});

const cancelButtonStyle = (busy: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.inkSoft,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.card,
  padding: '13px 20px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.65 : 1,
});

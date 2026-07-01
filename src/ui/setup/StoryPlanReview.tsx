/**
 * L4 — StoryPlanReview (Requirement 6.3). Presents the generated story plan (characters + plot)
 * for the learner to review and lightly edit (title / synopsis), then confirm. Confirmation is the
 * GATE to body generation: `onConfirm` fires only on the explicit action, never on mount, so no
 * chapter is generated until the learner accepts the plan. Purely presentational; StoryPlanner owns
 * generation and (post-confirm) persistence.
 */

import { useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { StoryPlan } from '../../types/domain';

export interface StoryPlanReviewProps {
  plan: StoryPlan;
  /** Fires with the (possibly edited) plan when the learner confirms — the body-generation gate. */
  onConfirm: (plan: StoryPlan) => void;
  /** Optional: discard this plan and regenerate. */
  onCancel?: () => void;
}

export function StoryPlanReview({ plan, onConfirm, onCancel }: StoryPlanReviewProps) {
  const [titleJa, setTitleJa] = useState(plan.titleJa);
  const [synopsisJa, setSynopsisJa] = useState(plan.synopsisJa);

  const confirm = (): void => onConfirm({ ...plan, titleJa, synopsisJa });

  return (
    <div style={cardStyle}>
      <div style={{ padding: '28px 34px 20px' }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted, marginBottom: 8 }}>
          物語の設定を確認・編集してください。確定すると本文の執筆を始めます。
        </div>
        <label style={fieldLabelStyle} htmlFor="story-title">
          タイトル
        </label>
        <input id="story-title" aria-label="タイトル" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} style={inputStyle} />
        <div style={{ marginTop: 6, fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>{titleJa}</div>
      </div>

      <div style={{ padding: '0 34px 8px' }}>
        <label style={fieldLabelStyle} htmlFor="story-synopsis">
          あらすじ
        </label>
        <textarea
          id="story-synopsis"
          aria-label="あらすじ"
          value={synopsisJa}
          onChange={(e) => setSynopsisJa(e.target.value)}
          rows={3}
          style={textareaStyle}
        />
      </div>

      <div style={{ padding: '8px 34px' }}>
        <div style={sectionLabelStyle}>登場人物</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plan.characters.map((ch) => (
            <div key={ch.name} style={characterRowStyle}>
              <span style={{ fontFamily: fonts.serif, fontWeight: 600, color: colors.ink }}>{ch.name}</span>
              <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>
                {ch.role} · {ch.descriptionJa}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 34px 20px' }}>
        <div style={sectionLabelStyle}>章立て</div>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {plan.chapters.map((c) => (
            <li key={c.index} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.inkSoft, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{c.headingJa}</span>
              {c.beatJa ? <span style={{ color: colors.faint }}> — {c.beatJa}</span> : null}
            </li>
          ))}
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '12px 34px 28px' }}>
        <button type="button" onClick={confirm} style={confirmButtonStyle}>
          この設定で執筆する
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} style={cancelButtonStyle}>
            やり直す
          </button>
        ) : null}
      </div>
    </div>
  );
}

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

const characterRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '8px 12px',
};

const confirmButtonStyle: CSSProperties = {
  flex: 1,
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.card,
  padding: 13,
  cursor: 'pointer',
};

const cancelButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.inkSoft,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.card,
  padding: '13px 20px',
  cursor: 'pointer',
};

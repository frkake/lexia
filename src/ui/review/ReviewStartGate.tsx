/**
 * L4 — ReviewStartGate: the pre-session confirmation screen (C-5c). Nothing is graded until the
 * learner presses 開始, and the queue is snapshotted at that moment — so the card count and the
 * "今日の復習 N 語" home count agree, and the session never remounts mid-review. It also owns the two
 * non-start states: an empty queue (with a "read something first" nudge + tomorrow's count) and a
 * daily-ceiling-reached state (start disabled, "また明日").
 */

import type { CSSProperties } from 'react';
import { estimatedSessionMinutes, type ReviewSessionPlan } from '../../domain/session/reviewSessionPlan';
import { colors, fonts, radius } from '../theme/tokens';

export interface ReviewStartGateProps {
  plan: ReviewSessionPlan;
  /** Effective daily ceiling (settings override or policy default) — shown in the "reached" copy. */
  dailyLimit: number;
  /** True when the session is scoped to a `/review?words=` set (changes the empty-state copy). */
  hasFilter: boolean;
  onStart(): void;
  onHome(): void;
  onGenerate(): void;
}

export function ReviewStartGate({ plan, dailyLimit, hasFilter, onStart, onHome, onGenerate }: ReviewStartGateProps) {
  const body = ((): { testId: string; content: React.ReactNode } => {
    if (plan.empty) {
      return {
        testId: 'review-empty',
        content: (
          <>
            <div style={titleStyle}>復習はお休みです</div>
            <p style={leadStyle}>
              {hasFilter
                ? '指定した語は、いま復習の対象ではありません。'
                : '復習できる語がまだありません。まず文章を読んで、語を増やしましょう。'}
            </p>
            {!hasFilter && plan.upcomingCount > 0 ? (
              <p style={subStyle}>次の復習は明日 {plan.upcomingCount} 語です。</p>
            ) : null}
            <div style={actionsStyle}>
              <button type="button" data-testid="review-generate" onClick={onGenerate} style={primaryStyle}>
                文章を生成
              </button>
              <button type="button" data-testid="review-home" onClick={onHome} style={secondaryStyle}>
                ホームへ
              </button>
            </div>
          </>
        ),
      };
    }

    if (plan.dailyLimitReached) {
      return {
        testId: 'review-limit-reached',
        content: (
          <>
            <div style={titleStyle}>今日の復習は完了です</div>
            <p style={leadStyle}>今日の上限 {dailyLimit} 枚に到達しました。</p>
            <p style={subStyle} data-testid="review-tomorrow-count">
              残りの {plan.dueTotal} 語は明日以降に復習できます。
            </p>
            <div style={actionsStyle}>
              <button type="button" data-testid="review-start-button" disabled style={{ ...primaryStyle, ...disabledStyle }}>
                開始
              </button>
              <button type="button" data-testid="review-home" onClick={onHome} style={secondaryStyle}>
                ホームへ
              </button>
            </div>
          </>
        ),
      };
    }

    const minutes = estimatedSessionMinutes(plan.sessionSize);
    return {
      testId: 'review-start-ready',
      content: (
        <>
          <div style={titleStyle}>復習の準備ができました</div>
          <p style={leadStyle} data-testid="review-start-count">
            今回 {plan.sessionSize} 枚（全 due {plan.dueTotal} 語中）
          </p>
          <p style={subStyle}>目安 約 {minutes} 分</p>
          <div style={actionsStyle}>
            <button type="button" data-testid="review-start-button" onClick={onStart} style={primaryStyle}>
              開始
            </button>
            <button type="button" data-testid="review-home" onClick={onHome} style={secondaryStyle}>
              ホームへ
            </button>
          </div>
        </>
      ),
    };
  })();

  return (
    <div style={wrapStyle}>
      <div style={cardStyle} data-testid="review-start-gate" data-state={body.testId}>
        {body.content}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  background: colors.surfacePage,
  padding: '64px 24px',
  minHeight: '60vh',
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  boxShadow: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  padding: '34px 34px 30px',
  textAlign: 'center',
};

const titleStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 20,
  fontWeight: 600,
  color: colors.ink,
};

const leadStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 15,
  color: colors.body,
  marginTop: 14,
  lineHeight: 1.7,
};

const subStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.muted,
  marginTop: 6,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 26,
};

const primaryStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 600,
  color: '#FFFFFF',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.control,
  padding: '13px 16px',
  cursor: 'pointer',
};

const secondaryStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '12px 16px',
  cursor: 'pointer',
};

const disabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};

/**
 * L4 — DashboardScreen (design.md "DashboardScreen", 10.1–10.6; Dashboard frame). Renders
 * the projected DashboardSnapshot as the route body under AppShell (which owns the brand /
 * nav header): greeting + today's due count + streak, the 4-stage mastery breakdown bar,
 * continue-reading CTAs for in-progress passages, a weekly-activity bar chart, a "needs
 * review" list that starts a session, and recently read passages. Presentational: the
 * snapshot is projected upstream (DashboardProjector) and supplied via props.
 *
 * Two layouts share one set of section markup (so the mastery/due encodings live in one place):
 *   - `full` (default): the standalone 2-column dashboard (main + right rail).
 *   - `rail`: a single narrow column for HomeScreen's right "ledger". Reorders to the cards that
 *     matter for *starting today* (resume → due+review → mastery → recent) and OMITS the
 *     width-hungry weekly chart, which only appears in the full layout.
 */

import { useNavigate } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import { MasteryDot } from '../shared/MasteryDot';
import { masteryColors, colors, fonts, radius } from '../theme/tokens';
import { DAY_MS } from '../../domain/srs/parameters';
import type { MasteryStage } from '../../types/domain';
import type { DashboardSnapshot, MasteryBreakdown } from '../../domain/dashboard/dashboardProjector';

export interface DashboardScreenProps {
  snapshot: DashboardSnapshot;
  /** Greeting name (the learner display name). */
  userName?: string;
  /** Optional translations for the due-word list (10.5 "訳"). */
  glosses?: Record<string, string>;
  /** Clock for the greeting + relative due labels (defaults to now). */
  now?: number;
  /**
   * Whether to render the greeting + pulse header. Standalone (its own route) keeps it; HomeScreen
   * hides it (false) because its masthead already carries the greeting/streak/due pulse.
   */
  showGreeting?: boolean;
  /**
   * `full` (default) = standalone 2-column dashboard. `rail` = single narrow column for
   * HomeScreen's ledger (recently-opened → due → mastery; weekly chart omitted).
   */
  layout?: 'full' | 'rail';
  onContinue?: (passageId: string, sentenceIndex: number) => void;
  onStartReview?: () => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const STAGE_SEGMENTS: { key: keyof Omit<MasteryBreakdown, 'total'>; stage: MasteryStage; label: string }[] = [
  { key: 'new', stage: 'New', label: '未学習' },
  { key: 'learning', stage: 'Learning', label: '学習中' },
  { key: 'consolidating', stage: 'Consolidating', label: '定着' },
  { key: 'mastered', stage: 'Mastered', label: '習熟' },
];

function greetingFor(now: number): string {
  const h = new Date(now).getHours();
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'こんばんは';
}

/** Relative day label for a due timestamp (今日 / 明日 / M/D). */
function dueLabel(dueAt: number, now: number): string {
  const diff = Math.floor(dueAt / DAY_MS) - Math.floor(now / DAY_MS);
  if (diff <= 0) return '今日';
  if (diff === 1) return '明日';
  const d = new Date(dueAt);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function DashboardScreen({
  snapshot,
  userName = '学習者',
  glosses = {},
  now = Date.now(),
  showGreeting = true,
  layout = 'full',
  onContinue,
  onStartReview,
}: DashboardScreenProps) {
  const navigate = useNavigate();
  const { mastery } = snapshot;

  const continueReading = (passageId: string, sentenceIndex: number): void => {
    if (onContinue) onContinue(passageId, sentenceIndex);
    else void navigate('/library');
  };
  const startReview = (): void => {
    if (onStartReview) onStartReview();
    else void navigate('/review');
  };

  const weeklyMax = Math.max(1, ...snapshot.weekly.map((d) => d.reviewCount));

  // ── section markup (shared by both layouts) ──────────────────────────────────

  const greetingBlock: ReactNode = showGreeting ? (
    <div>
      <div style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink }}>
        {greetingFor(now)}、{userName}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 7 }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.muted }}>
          今日は <span style={{ color: colors.primary, fontWeight: 600 }}>{snapshot.dueTodayCount}語</span> が復習のタイミングです。文章を読みながら定着させましょう。
        </div>
        <span style={streakChipStyle}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.green }} />
          {snapshot.streakDays}日連続
        </span>
      </div>
    </div>
  ) : null;

  const masteryCard: ReactNode = (
    <section style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={sectionTitleStyle}>
          習熟度の内訳 <span style={{ color: colors.faint, fontWeight: 400 }}>Mastery</span>
        </div>
        <div style={{ fontFamily: fonts.num, fontSize: 13, color: colors.muted }}>
          全 <span style={{ color: colors.ink, fontWeight: 600 }}>{mastery.total.toLocaleString('en-US')}</span> 語
        </div>
      </div>
      <div data-testid="mastery-bar" style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
        {STAGE_SEGMENTS.map(({ key, stage }) => {
          const pct = mastery.total > 0 ? (mastery[key] / mastery.total) * 100 : 0;
          return (
            <div
              key={key}
              data-testid={`mastery-seg-${key}`}
              style={{ width: `${pct}%`, background: masteryColors[stage] }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {STAGE_SEGMENTS.map(({ key, stage, label }) => (
          <div key={key} style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: masteryColors[stage] }} />
              <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{label}</span>
            </div>
            <div style={{ fontFamily: fonts.num, fontSize: 20, fontWeight: 600, color: colors.ink, marginTop: 4 }}>
              {mastery[key]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const continueCards: ReactNode[] = snapshot.reading.map((r) => (
    <section key={r.passageId} style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: 7, background: colors.primary }} />
      <div style={{ padding: '22px 24px', flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, letterSpacing: '.04em', color: colors.primary, marginBottom: 8 }}>
          最近開いた文章 / CONTINUE
        </div>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, fontWeight: 500, color: colors.ink, lineHeight: 1.4 }}>
          {r.title}
        </div>
        {r.level ? (
          <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginTop: 5 }}>LEVEL {r.level}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <div style={{ flex: 1, height: 6, background: colors.track, borderRadius: radius.track, overflow: 'hidden' }}>
            <div style={{ width: `${r.percent}%`, height: '100%', background: colors.primary }} />
          </div>
          <span style={{ fontFamily: fonts.num, fontSize: 12, color: colors.muted }}>{r.percent}%</span>
          <button type="button" onClick={() => continueReading(r.passageId, r.sentenceIndex)} style={primaryButtonStyle}>
            続きを読む
          </button>
        </div>
      </div>
    </section>
  ));

  const weeklyCard: ReactNode = (
    <section style={cardStyle}>
      <div style={{ ...sectionTitleStyle, marginBottom: 18 }}>
        今週の学習 <span style={{ color: colors.faint, fontWeight: 400 }}>This week</span>
      </div>
      <div data-testid="weekly-bars" style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 96 }}>
        {snapshot.weekly.map((d, i) => {
          const ratio = d.reviewCount / weeklyMax;
          const height = Math.max(8, Math.round(ratio * 88));
          const isMax = d.reviewCount === weeklyMax && weeklyMax > 1;
          const fill = d.reviewCount === 0 ? '#EBEEF2' : isMax ? colors.primary : '#A9C2E2';
          return (
            <div key={d.dayStartMs} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div
                data-testid={`weekly-bar-${i}`}
                style={{ width: '100%', maxWidth: 34, height, background: fill, borderRadius: '4px 4px 0 0' }}
              />
              <span style={{ fontFamily: fonts.num, fontSize: 11, color: colors.faint }}>
                {WEEKDAYS[new Date(d.dayStartMs).getUTCDay()]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );

  const dueCard: ReactNode = (
    <section style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={sectionTitleStyle}>復習が必要な単語</div>
        <span style={dueBadgeStyle}>{snapshot.dueTodayCount}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {snapshot.dueList.map((d, i) => (
          <div
            key={d.wordId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '9px 0',
              borderBottom: i < snapshot.dueList.length - 1 ? `1px solid ${colors.dividerRow}` : 'none',
            }}
          >
            <MasteryDot stage={d.mastery} size={8} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink }}>{d.wordId}</span>
              {glosses[d.wordId] ? (
                <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginLeft: 8 }}>
                  {glosses[d.wordId]}
                </span>
              ) : null}
            </div>
            <span style={{ fontFamily: fonts.ui, fontSize: 11, color: dueLabel(d.dueAt, now) === '今日' ? colors.terracotta : colors.muted }}>
              {dueLabel(d.dueAt, now)}
            </span>
          </div>
        ))}
      </div>
      <button type="button" onClick={startReview} style={softButtonStyle}>
        復習をはじめる
      </button>
    </section>
  );

  // ── rail layout: single narrow column, resume-first, no weekly chart ──────────
  // The ledger is a slim margin, so surface only the single most-recently-opened passage
  // here ("continue where you left off"); the rest of the in-progress reading stays in the
  // Library. The full dashboard shows the projector's bounded few.
  if (layout === 'rail') {
    return (
      <div className="dashboard-rail" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {continueCards.slice(0, 1)}
        {dueCard}
        {masteryCard}
      </div>
    );
  }

  // ── full layout: standalone 2-column dashboard ────────────────────────────────
  return (
    <div
      style={{ display: 'flex', gap: 28, padding: showGreeting ? 32 : 0, background: colors.surfacePage }}
      className="dashboard-layout"
    >
      {/* main column */}
      <div style={{ flex: 1.7, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {greetingBlock}
        {masteryCard}
        {continueCards}
        {weeklyCard}
      </div>

      {/* right rail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {dueCard}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '22px 24px',
};

const sectionTitleStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink };

const streakChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.inkSoft,
};

const primaryButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.chip,
  padding: '9px 18px',
  cursor: 'pointer',
};

const softButtonStyle: CSSProperties = {
  width: '100%',
  marginTop: 16,
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: 'none',
  borderRadius: radius.chip,
  padding: 10,
  cursor: 'pointer',
};

const dueBadgeStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  background: colors.terracotta,
  borderRadius: 10,
  padding: '2px 9px',
};

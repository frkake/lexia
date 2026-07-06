/**
 * L4 — HomeScreen: the app entry (/). A "writing desk" layout instead of one tall column.
 * A masthead band spans the top (date + serif greeting on the left, the day's two figures —
 * today's review count and the learning streak — as a glanceable stat cluster on the right).
 * Below, a two-column body: the generation form is the working surface (`.home-compose`, the
 * reused SetupScreen) and a slim progress ledger runs down the right margin (`.home-ledger`,
 * the reused DashboardScreen in its `rail` layout: recently-opened → due → mastery). Page
 * height is now band + max(form, ledger) rather than the sum of three stacked full-width blocks.
 * Presentational: setup props + a projected DashboardSnapshot are injected; navigation is delegated.
 * No dashboard/setup logic is duplicated here — only the greeting copy, which is page-entry chrome.
 */

import type { CSSProperties } from 'react';
import { SetupScreen, type SetupScreenProps } from '../setup/SetupScreen';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { colors, fonts } from '../theme/tokens';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

export interface HomeScreenProps {
  setup: SetupScreenProps;
  snapshot?: DashboardSnapshot;
  /** Greeting name in the masthead (the learner display name). */
  userName?: string;
  /** Clock for the greeting + date eyebrow (defaults to now). */
  now?: number;
  /** Resume the CONTINUE card's passage (F-2: the exact passageId, not merely "the newest"). */
  onContinue?: (passageId: string, sentenceIndex: number) => void;
  onStartReview?: () => void;
  /** D-5: JA gloss per due word id, shown beside the headword in the「復習が必要な単語」list. */
  glosses?: Record<string, string>;
  /** D-5: open a due word's detail card (overlay). */
  onSelectWord?: (wordId: string) => void;
  /** D-5: jump to the wordbook filtered to要復習 when the due list is truncated. */
  onShowAllDue?: () => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** Time-of-day greeting (mirrors DashboardScreen's, kept local as page-entry copy). */
function greetingFor(now: number): string {
  const h = new Date(now).getHours();
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'こんばんは';
}

/** Localized date eyebrow, e.g. "2026年7月2日 水曜日". */
function dateEyebrow(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}曜日`;
}

export function HomeScreen({
  setup,
  snapshot,
  userName = '学習者',
  now = Date.now(),
  onContinue,
  onStartReview,
  glosses,
  onSelectWord,
  onShowAllDue,
}: HomeScreenProps) {
  return (
    <div className="home-page">
      <header className="home-masthead" style={mastheadStyle}>
        <div className="home-greeting">
          <div style={eyebrowStyle}>{dateEyebrow(now)}</div>
          <h1 style={greetingStyle}>
            {greetingFor(now)}、{userName}
          </h1>
          <p style={subtitleStyle}>
            {snapshot
              ? '読みながら、今日の単語を定着させましょう。'
              : '文章を作って、今日の学習をはじめましょう。'}
          </p>
        </div>

        {snapshot ? (
          <div className="home-stats" style={statsRowStyle}>
            {/* D-6: the review figure is a tap target that jumps straight to /review, so the masthead
                count on a phone (where the "復習をはじめる" card sits far below) is actionable. */}
            <Stat label="今日の復習" value={snapshot.dueTodayCount} unit="語" accent onClick={onStartReview} />
            <Stat label="学習の継続" value={snapshot.streakDays} unit="日連続" />
          </div>
        ) : null}
      </header>

      <div className="home-body">
        <div className="home-compose">
          <SetupScreen {...setup} />
        </div>

        {snapshot ? (
          <aside className="home-ledger" aria-label="学習の状況">
            <div style={ledgerHeadStyle}>
              <span style={ledgerHeadJpStyle}>学習の状況</span>
              <span style={ledgerHeadEnStyle}>PROGRESS</span>
            </div>
            <DashboardScreen
              snapshot={snapshot}
              now={now}
              showGreeting={false}
              layout="rail"
              glosses={glosses}
              onContinue={onContinue}
              onStartReview={onStartReview}
              onSelectWord={onSelectWord}
              onShowAllDue={onShowAllDue}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A single masthead figure: tiny caps label over a large tabular number with a small unit.
 * When `onClick` is supplied the tile renders as a real <button> (D-6: keyboard + tap operable),
 * otherwise as a plain <div>; the visual (statTileStyle) is identical either way. */
function Stat({
  label,
  value,
  unit,
  accent = false,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span style={statLabelStyle}>{label}</span>
      <span style={statValueRowStyle}>
        <span style={{ ...statNumberStyle, color: accent ? colors.primary : colors.ink }}>{value}</span>
        <span style={statUnitStyle}>{unit}</span>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} ${value}${unit} — 復習をはじめる`}
        style={{ ...statTileStyle, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
      >
        {body}
      </button>
    );
  }
  return <div style={statTileStyle}>{body}</div>;
}

// ── masthead ────────────────────────────────────────────────────────────────

const mastheadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 28,
  background: `linear-gradient(150deg, ${colors.surfaceBlue} 0%, ${colors.surfacePage} 82%)`,
  border: `1px solid ${colors.primaryBorder2}`,
  borderRadius: 16,
  padding: '26px 30px',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.12em',
  color: colors.primary,
};

const greetingStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 30,
  fontWeight: 500,
  color: colors.ink,
  margin: '8px 0 0',
  lineHeight: 1.2,
};

const subtitleStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  lineHeight: 1.5,
  color: colors.muted,
  margin: '8px 0 0',
};

// ── masthead stat cluster (the signature element) ────────────────────────────

const statsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 'none',
};

const statTileStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 108,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: 12,
  padding: '13px 16px 12px',
  boxShadow: '0 1px 2px rgba(25,40,65,.05)',
};

const statLabelStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.06em',
  color: colors.faint,
};

const statValueRowStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 4 };

const statNumberStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 30,
  fontWeight: 600,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};

const statUnitStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: colors.muted,
};

// ── ledger head ───────────────────────────────────────────────────────────────

const ledgerHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  padding: '0 2px',
  marginBottom: 14,
};

const ledgerHeadJpStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 17,
  fontWeight: 500,
  color: colors.ink,
};

const ledgerHeadEnStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.14em',
  color: colors.faint,
};

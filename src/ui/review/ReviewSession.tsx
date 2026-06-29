/**
 * L4 — ReviewSession (design.md "ReviewSession", 9.1–9.6; Review frame). Walks the
 * review queue one word at a time: a new-context ContextCard with the target highlighted,
 * a reveal step that shows meaning / collocations / related info (9.3), a mastery-progress
 * dot row with the remaining-reps estimate (9.6), and four difficulty buttons each labelled
 * with `FsrsScheduler.simulate`'s next interval (9.4). Rating a word emits `onRate` with the
 * simulated next state and advances; the reschedule + ReviewLog append is wired in task 10.3.
 */

import { useState, type CSSProperties } from 'react';
import { fsrs } from '../../domain/srs/fsrsScheduler';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { MINUTE_MS, HOUR_MS, DAY_MS } from '../../domain/srs/parameters';
import { MasteryDot } from '../shared/MasteryDot';
import { colors, fonts, radius } from '../theme/tokens';
import type { MasteryStage, Rating, WordSchedulingState } from '../../types/domain';

export interface ReviewItem {
  /** Current FSRS state — drives simulate(), the progress dots and the remaining estimate. */
  state: WordSchedulingState;
  headword: string;
  ipa?: string;
  /** New-context example sentence split around the target surface. */
  context: { before: string; target: string; after: string };
  answer: {
    meaningJa: string;
    detailJa?: string;
    collocations?: string[];
    register?: string;
    synonyms?: string[];
  };
}

export interface ReviewSessionProps {
  queue: ReviewItem[];
  /** Fixed clock for deterministic interval simulation (defaults to now). */
  now?: number;
  onRate?: (wordId: string, rating: Rating, simulated: WordSchedulingState) => void;
  onComplete?: () => void;
}

const RATINGS: { rating: Rating; label: string; style: 'again' | 'hard' | 'good' | 'easy' }[] = [
  { rating: 1, label: 'もう一度', style: 'again' },
  { rating: 2, label: '難しい', style: 'hard' },
  { rating: 3, label: '普通', style: 'good' },
  { rating: 4, label: '簡単', style: 'easy' },
];

const STAGE_JA: Record<MasteryStage, string> = {
  New: '未学習',
  Learning: '学習中',
  Consolidating: '定着',
  Mastered: '習熟',
};

const PROGRESS_DOTS = 5;

/** Human-readable interval label for a simulated next-review delay. */
export function formatInterval(ms: number): string {
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)}分`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}時間`;
  if (ms < 30 * DAY_MS) return `${Math.round(ms / DAY_MS)}日`;
  return `${Math.round(ms / (30 * DAY_MS))}か月`;
}

export function ReviewSession({ queue, now = Date.now(), onRate, onComplete }: ReviewSessionProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);

  const total = queue.length;

  if (done || index >= total) {
    return (
      <div style={centerWrapStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 21, fontWeight: 600, color: colors.ink }}>
          復習が完了しました
        </div>
        <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginTop: 8 }}>
          {total} 語を確認しました。お疲れさまでした。
        </div>
      </div>
    );
  }

  const current = queue[index]!;
  const stage = masteryProjector.deriveMastery(current.state, { kind: 'none' });
  const remaining = fsrs.repsToConsolidate(current.state);
  const filledDots = Math.max(0, Math.min(PROGRESS_DOTS, PROGRESS_DOTS - remaining));
  const progressNote =
    stage === 'Consolidating' || stage === 'Mastered'
      ? STAGE_JA[stage]
      : `${STAGE_JA[stage]} → あと${remaining}回で定着`;

  const rate = (rating: Rating): void => {
    const simulated = fsrs.simulate(current.state, rating, now);
    onRate?.(current.state.wordId, rating, simulated);
    const next = index + 1;
    setRevealed(false);
    if (next >= total) {
      setDone(true);
      onComplete?.();
    } else {
      setIndex(next);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div style={cardStyle}>
        {/* Header: title + progress */}
        <div style={headerStyle}>
          <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>復習セッション</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 160, height: 6, background: colors.track, borderRadius: radius.track, overflow: 'hidden' }}>
              <div style={{ width: `${((index + 1) / total) * 100}%`, height: '100%', background: colors.primary }} />
            </div>
            <span style={{ fontFamily: fonts.num, fontSize: 13, color: colors.muted }}>
              {index + 1} / {total}
            </span>
          </div>
        </div>

        <div style={{ padding: '38px 40px 34px', background: colors.surfacePage }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, letterSpacing: '.04em' }}>
              新しい文脈で意味を思い出せますか？
            </span>
          </div>

          {/* Context card */}
          <div style={contextCardStyle}>
            <div style={{ fontFamily: fonts.serifJp, fontSize: 21, lineHeight: 1.85, color: colors.body, textAlign: 'center' }}>
              {current.context.before}
              <span data-testid="review-target" style={targetStyle}>
                {current.context.target}
              </span>
              {current.context.after}
            </div>
            <div style={{ textAlign: 'center', marginTop: 22 }}>
              <span style={{ fontFamily: fonts.serif, fontSize: 26, fontWeight: 600, color: colors.ink }}>
                {current.headword}
              </span>
              {current.ipa ? (
                <span style={{ fontFamily: fonts.num, fontSize: 13, color: colors.faint, marginLeft: 10 }}>
                  {current.ipa}
                </span>
              ) : null}
            </div>

            {revealed ? (
              <div data-testid="review-answer" style={{ marginTop: 20, borderTop: `1px dashed ${colors.borderControl}`, paddingTop: 20 }}>
                <div style={{ textAlign: 'center', fontFamily: fonts.bodyJp, fontSize: 16, fontWeight: 600, color: colors.ink }}>
                  {current.answer.meaningJa}
                </div>
                {current.answer.detailJa ? (
                  <div style={{ textAlign: 'center', fontFamily: fonts.bodyJp, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 1.6 }}>
                    {current.answer.detailJa}
                    {current.answer.synonyms?.length ? (
                      <span style={{ color: colors.faint, marginLeft: 6 }}>≒ {current.answer.synonyms.join(' / ')}</span>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
                  {current.answer.collocations?.map((c) => (
                    <span key={c} style={collocationChipStyle}>
                      {c}
                    </span>
                  ))}
                  {current.answer.register ? <span style={registerChipStyle}>{current.answer.register}</span> : null}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginTop: 22 }}>
                <button type="button" onClick={() => setRevealed(true)} style={revealButtonStyle}>
                  解答を見る
                </button>
              </div>
            )}
          </div>

          {/* Mastery progress */}
          <div
            data-testid="review-progress"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, margin: '24px 0 20px' }}
          >
            <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>習熟度</span>
            {Array.from({ length: PROGRESS_DOTS }, (_, i) => (
              <MasteryDot key={i} stage={i < filledDots ? stage : undefined} size={9} />
            ))}
            <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{progressNote}</span>
          </div>

          {/* Difficulty buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            {RATINGS.map(({ rating, label, style }) => {
              const simulated = fsrs.simulate(current.state, rating, now);
              const interval = formatInterval(Math.max(0, simulated.dueAt - now));
              const sk = RATE_SKIN[style];
              return (
                <button
                  key={rating}
                  type="button"
                  data-testid={`rate-${rating}`}
                  onClick={() => rate(rating)}
                  style={rateButtonStyle(sk)}
                >
                  <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: sk.fg }}>{label}</div>
                  <div style={{ fontFamily: fonts.num, fontSize: 11, color: sk.sub, marginTop: 3 }}>{interval}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface RateSkin {
  fg: string;
  sub: string;
  bg: string;
  border: string;
}

const RATE_SKIN: Record<'again' | 'hard' | 'good' | 'easy', RateSkin> = {
  again: { fg: colors.terracotta, sub: colors.terracottaSoft, bg: colors.surfaceCard, border: colors.terracottaBorder },
  hard: { fg: colors.inkSoft, sub: colors.faint, bg: colors.surfaceCard, border: colors.borderControl },
  good: { fg: colors.primary, sub: colors.primarySoft, bg: colors.surfaceBlue, border: colors.primaryBorder },
  easy: { fg: colors.greenDeep, sub: '#6FA99A', bg: colors.greenBg, border: colors.greenBorder },
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 880,
  background: colors.surfaceCard,
  borderRadius: radius.card,
  boxShadow: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '18px 30px',
  borderBottom: `1px solid ${colors.dividerSection}`,
};

const contextCardStyle: CSSProperties = {
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: 10,
  padding: '34px 38px',
};

const targetStyle: CSSProperties = {
  background: colors.highlight,
  borderBottom: `2px solid ${colors.primary}`,
  borderRadius: 2,
  padding: '1px 6px',
  fontWeight: 500,
};

const collocationChipStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  color: colors.primaryDeep,
  background: '#EAF0F8',
  borderRadius: 5,
  padding: '4px 10px',
};

const registerChipStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.primary,
  background: '#EAF0F8',
  borderRadius: 5,
  padding: '4px 10px',
};

const revealButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '9px 20px',
  cursor: 'pointer',
};

const rateButtonStyle = (sk: RateSkin): CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  background: sk.bg,
  border: `1px solid ${sk.border}`,
  borderRadius: radius.card,
  padding: 12,
  cursor: 'pointer',
});

const centerWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '80px 24px',
  background: colors.surfacePage,
};

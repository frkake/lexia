/**
 * L4 — ReviewSession (design.md "ReviewSession", 9.1–9.6; Review frame). Walks the
 * review queue one word at a time: a new-context ContextCard with the target highlighted,
 * a reveal step that shows meaning / collocations / related info (9.3), a mastery-progress
 * dot row with the remaining-reps estimate (9.6), and four difficulty buttons each labelled
 * with `FsrsScheduler.simulate`'s next interval (9.4). Rating a word emits `onRate` with the
 * simulated next state and advances; the reschedule + ReviewLog append is wired in task 10.3.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fsrs } from '../../domain/srs/fsrsScheduler';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { MINUTE_MS, HOUR_MS, DAY_MS, S_CONSOLIDATE, LEECH_LAPSE_THRESHOLD } from '../../domain/srs/parameters';
import { showToast } from '../../state/stores/toastStore';
import { colors, fonts, radius } from '../theme/tokens';
import type { MasteryStage, Rating, WordSchedulingState } from '../../types/domain';

export interface ReviewItem {
  /** Current FSRS state — drives simulate(), the progress dots and the remaining estimate. */
  state: WordSchedulingState;
  /** True while this card's WordData is still being fetched (E-3(f) lazy queue load). */
  loading?: boolean;
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
  /** Called on every rating with the simulated next state AND the pre-rating state (for Undo). */
  onRate?: (wordId: string, rating: Rating, simulated: WordSchedulingState, prior: WordSchedulingState) => void;
  /** Called when "1つ戻る" undoes the last rating: restore the prior scheduling state + offsetting log. */
  onUndo?: (wordId: string, prior: WordSchedulingState, ratingUndone: Rating) => void;
  /** Fired once when the session ends (last card graded or "ここまでで終了"). A signal, not navigation. */
  onComplete?: () => void;
  /** "ホームへ" from the completion screen. */
  onHome?: () => void;
  /** "この語群で文章を生成": preset these words on the generation screen. */
  onGenerateFromWords?: (wordIds: string[]) => void;
  /** Open a word's detail card (leech elaboration link). */
  onOpenWord?: (wordId: string) => void;
}

/**
 * One queue slot — the CONTROL state that is frozen at session start. It carries only the word id,
 * its (possibly rescheduled) scheduling state and its round, NOT the display data: headword / answer
 * / example stream in later via the `queue` prop keyed by word id (E-3(f) lazy load), so a card's
 * data can arrive without ever remounting or resetting the session.
 */
interface WorkEntry {
  wordId: string;
  round: number;
  state: WordSchedulingState;
}

/** A recorded rating action (drives the completion stats + one-step Undo). */
interface RatingEvent {
  wordId: string;
  headword: string;
  rating: Rating;
  prior: WordSchedulingState;
  simulated: WordSchedulingState;
  stage: MasteryStage;
  lapses: number;
}

/** The single-depth Undo snapshot captured just before a rating is applied. */
interface UndoSnapshot {
  entries: WorkEntry[];
  index: number;
  historyLen: number;
  wordId: string;
  prior: WordSchedulingState;
  rating: Rating;
}

const RATINGS: { rating: Rating; label: string; style: 'again' | 'hard' | 'good' | 'easy' }[] = [
  { rating: 1, label: '知らなかった', style: 'again' },
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

/** Cap on how many times an Again/Hard word may be re-queued within one session (policy: 上限2周). */
const MAX_ROUNDS = 2;

/** Human-readable interval label for a simulated next-review delay. */
export function formatInterval(ms: number): string {
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)}分`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}時間`;
  if (ms < 30 * DAY_MS) return `${Math.round(ms / DAY_MS)}日`;
  return `${Math.round(ms / (30 * DAY_MS))}か月`;
}

export function ReviewSession({
  queue,
  now = Date.now(),
  onRate,
  onUndo,
  onComplete,
  onHome,
  onGenerateFromWords,
  onOpenWord,
}: ReviewSessionProps) {
  const [entries, setEntries] = useState<WorkEntry[]>(() =>
    queue.map((item) => ({ wordId: item.state.wordId, round: 1, state: item.state })),
  );
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [history, setHistory] = useState<RatingEvent[]>([]);
  const [undoSnap, setUndoSnap] = useState<UndoSnapshot | null>(null);

  // Display data streams in via the prop; the control state above stays frozen. Looking each card's
  // headword/answer/example up by word id keeps the session stable while WordData loads lazily.
  const byId = new Map(queue.map((item) => [item.state.wordId, item] as const));
  const headwordOf = (wordId: string): string => byId.get(wordId)?.headword ?? wordId;

  const ratedCount = history.length;

  const finish = (): void => {
    setDone(true);
    onComplete?.();
  };

  // Single-depth Undo, reachable from BOTH the header "1つ戻る" button and the post-rating toast's
  // "取り消す" action — the one shared Undo mechanism (D6). The ref keeps the toast pointed at the
  // LATEST snapshot, so an older toast can only ever undo the most recent rating (else no-op).
  const applyUndo = (): void => {
    const snap = undoSnap;
    if (!snap) return;
    setEntries(snap.entries);
    setIndex(snap.index);
    setHistory((h) => h.slice(0, snap.historyLen));
    setDone(false);
    setRevealed(true);
    setUndoSnap(null);
    onUndo?.(snap.wordId, snap.prior, snap.rating);
  };
  const undoRef = useRef<() => void>(() => {});
  undoRef.current = applyUndo;

  const rate = (rating: Rating): void => {
    if (!revealed || done) return; // reveal gate: no rating before the answer is shown
    const entry = entries[index]!;
    const prior = entry.state;
    const simulated = fsrs.simulate(prior, rating, now);
    const stage = masteryProjector.deriveMastery(simulated, { kind: 'review', rating });

    // Again/Hard re-surface later in the same session (up to MAX_ROUNDS appearances) with the
    // rescheduled state, so the learner keeps drilling until at least a Good sticks.
    const reinsert = (rating === 1 || rating === 2) && entry.round < MAX_ROUNDS;
    const nextEntries = reinsert
      ? [...entries, { wordId: entry.wordId, round: entry.round + 1, state: simulated }]
      : entries;

    const event: RatingEvent = {
      wordId: entry.wordId,
      headword: headwordOf(entry.wordId),
      rating,
      prior,
      simulated,
      stage,
      lapses: simulated.lapses,
    };

    setUndoSnap({ entries, index, historyLen: history.length, wordId: entry.wordId, prior, rating });
    setEntries(nextEntries);
    setHistory((h) => [...h, event]);
    setRevealed(false);
    onRate?.(entry.wordId, rating, simulated, prior);

    showToast({
      message: `「${event.headword}」を評定しました`,
      tone: 'info',
      durationMs: 6000,
      action: { label: '取り消す', onAction: () => undoRef.current() },
    });

    const nextIndex = index + 1;
    if (nextIndex >= nextEntries.length) finish();
    else setIndex(nextIndex);
  };

  const skip = (): void => {
    if (done) return;
    setRevealed(false);
    setUndoSnap(null);
    const nextIndex = index + 1;
    if (nextIndex >= entries.length) finish();
    else setIndex(nextIndex);
  };

  const restartWith = (words: { wordId: string; state: WordSchedulingState }[]): void => {
    setEntries(words.map((w) => ({ wordId: w.wordId, round: 1, state: w.state })));
    setIndex(0);
    setRevealed(false);
    setDone(false);
    setHistory([]);
    setUndoSnap(null);
  };

  // D-8: Anki-style keyboard grading. Space/Enter reveals the answer; 1–4 grade the card once it is
  // revealed. It honours the reveal gate (rate() no-ops before reveal), stands down while the card's
  // data is still loading or the session is over, and ignores keys typed into a text field. A focused
  // button/link keeps its own native Space/Enter activation; number keys work regardless of focus.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (event: KeyboardEvent): void => {
    if (done) return;
    const active = entries[index];
    if (!active) return;
    const displayForActive = byId.get(active.wordId);
    if (!displayForActive || displayForActive.loading === true) return; // answer not ready yet
    const node = event.target as HTMLElement | null;
    const tag = node?.tagName;
    if (node && (node.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;
    if (event.key === ' ' || event.key === 'Enter') {
      if (tag === 'BUTTON' || tag === 'A') return; // let the focused control activate natively
      if (!revealed) {
        event.preventDefault();
        setRevealed(true);
      }
      return;
    }
    if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4') {
      if (revealed) {
        event.preventDefault();
        rate(Number(event.key) as Rating);
      }
    }
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent): void => shortcutRef.current(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (done || entries.length === 0 || index >= entries.length) {
    return (
      <ReviewComplete
        history={history}
        onRestartAgain={restartWith}
        onGenerateFromWords={onGenerateFromWords}
        onHome={onHome}
        onOpenWord={onOpenWord}
      />
    );
  }

  const entry = entries[index]!;
  const state = entry.state;
  const display = byId.get(entry.wordId);
  const headword = display?.headword ?? entry.wordId;
  const loading = !display || display.loading === true; // no display yet ⇒ still loading (E-3(f))
  const context = display?.context ?? { before: '', target: headword, after: '' };
  const answer = display?.answer;
  const stage = masteryProjector.deriveMastery(state, { kind: 'none' });
  const remaining = fsrs.repsToConsolidate(state);
  const s = state.stability ?? 0;
  const consolidated = stage === 'Consolidating' || stage === 'Mastered';
  const consolidateProgress = consolidated ? 1 : Math.max(0.04, Math.min(1, Math.log1p(s) / Math.log1p(S_CONSOLIDATE)));
  const remainingCards = entries.length - index;
  const barProgress = ratedCount / (ratedCount + remainingCards);

  return (
    <div className="review-frame" style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div style={cardStyle}>
        {/* Header: title + progress. The denominator is rated + still-remaining work (matching
            barProgress), NOT the frozen initial queue length: Again/Hard re-drills append extra cards
            to `entries`, so a fixed `queue.length` denominator would be exceeded by `ratedCount` once
            any re-drilled card is graded (e.g. "6 / 5"). This keeps numerator ≤ denominator always. */}
        <div style={headerStyle}>
          <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>復習セッション</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 160, height: 6, background: colors.track, borderRadius: radius.track, overflow: 'hidden' }}>
              <div data-testid="review-progressbar" style={{ width: `${barProgress * 100}%`, height: '100%', background: colors.primary }} />
            </div>
            <span data-testid="review-counter" style={{ fontFamily: fonts.num, fontSize: 13, color: colors.muted }}>
              {ratedCount} / {ratedCount + remainingCards}
            </span>
          </div>
        </div>

        {/* Session controls: one-step Undo + skip + early end */}
        <div style={sessionToolbarStyle}>
          <button
            type="button"
            data-testid="review-undo"
            onClick={applyUndo}
            disabled={!undoSnap}
            style={toolbarButtonStyle(!!undoSnap)}
          >
            ← 1つ戻る
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" data-testid="review-skip" onClick={skip} style={toolbarButtonStyle(true)}>
            スキップ
          </button>
          <button type="button" data-testid="review-end" onClick={finish} style={toolbarButtonStyle(true)}>
            ここまでで終了
          </button>
        </div>

        <div className="review-body" style={{ padding: '28px 40px 34px', background: colors.surfacePage }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, letterSpacing: '.04em' }}>
              新しい文脈で意味を思い出せますか？
            </span>
          </div>

          {/* Context card */}
          <div style={contextCardStyle}>
            <div style={{ fontFamily: fonts.serifJp, fontSize: 21, lineHeight: 1.85, color: colors.body, textAlign: 'center' }}>
              {context.before}
              <span data-testid="review-target" style={targetStyle}>
                {context.target}
              </span>
              {context.after}
            </div>
            <div style={{ textAlign: 'center', marginTop: 22 }}>
              <span style={{ fontFamily: fonts.serif, fontSize: 26, fontWeight: 600, color: colors.ink }}>{headword}</span>
              {display?.ipa ? (
                <span style={{ fontFamily: fonts.num, fontSize: 13, color: colors.faint, marginLeft: 10 }}>{display.ipa}</span>
              ) : null}
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', marginTop: 22 }}>
                <span
                  data-testid="review-loading"
                  style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, letterSpacing: '.04em' }}
                >
                  解答を準備中…
                </span>
              </div>
            ) : revealed ? (
              <div data-testid="review-answer" style={{ marginTop: 20, borderTop: `1px dashed ${colors.borderControl}`, paddingTop: 20 }}>
                <div style={{ textAlign: 'center', fontFamily: fonts.bodyJp, fontSize: 16, fontWeight: 600, color: colors.ink }}>
                  {answer?.meaningJa}
                </div>
                {answer?.detailJa ? (
                  <div style={{ textAlign: 'center', fontFamily: fonts.bodyJp, fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 1.6 }}>
                    {answer.detailJa}
                    {answer.synonyms?.length ? (
                      <span style={{ color: colors.faint, marginLeft: 6 }}>≒ {answer.synonyms.join(' / ')}</span>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
                  {answer?.collocations?.map((col) => (
                    <span key={col} style={collocationChipStyle}>
                      {col}
                    </span>
                  ))}
                  {answer?.register ? <span style={registerChipStyle}>{answer.register}</span> : null}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginTop: 22 }}>
                <button type="button" data-testid="review-reveal" onClick={() => setRevealed(true)} style={revealButtonStyle}>
                  解答を見る
                  <span style={revealKeyHintStyle}>Space</span>
                </button>
              </div>
            )}
          </div>

          {/* Mastery progress: "定着まであと N 回" + a log-scaled stability bar (replaces the 5-dot row) */}
          <div data-testid="review-progress" style={{ margin: '24px 0 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>習熟度</span>
              <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>
                {consolidated ? STAGE_JA[stage] : `定着まであと${remaining}回`}
              </span>
            </div>
            <div style={{ height: 6, background: colors.track, borderRadius: radius.track, overflow: 'hidden' }}>
              <div style={{ width: `${consolidateProgress * 100}%`, height: '100%', background: colors.primary }} />
            </div>
          </div>

          {/* Difficulty buttons — disabled until the answer is revealed (reveal gate).
              On phones (≤600px) the row becomes a 2×2 grid (global.css .review-rate-row) so the
              4 labels never wrap character-by-character in a ~64px-wide flex cell. */}
          <div className="review-rate-row" style={{ display: 'flex', gap: 10 }}>
            {RATINGS.map(({ rating, label, style }) => {
              const simulated = fsrs.simulate(state, rating, now);
              const interval = formatInterval(Math.max(0, simulated.dueAt - now));
              const sk = RATE_SKIN[style];
              return (
                <button
                  key={rating}
                  type="button"
                  data-testid={`rate-${rating}`}
                  disabled={!revealed || loading}
                  onClick={() => rate(rating)}
                  style={{ ...rateButtonStyle(sk), opacity: revealed ? 1 : 0.45, cursor: revealed ? 'pointer' : 'not-allowed' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <span aria-hidden="true" style={rateKeyHintStyle(sk)}>{rating}</span>
                    <span style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: sk.fg }}>{label}</span>
                  </div>
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

/** Completion screen: rating breakdown, consolidation/again tallies, leech elaboration links and the
 * three next actions (再挑戦 / 語群から生成 / ホーム). Replaces the old "N 語を確認しました" stub. */
function ReviewComplete({
  history,
  onRestartAgain,
  onGenerateFromWords,
  onHome,
  onOpenWord,
}: {
  history: RatingEvent[];
  onRestartAgain: (words: { wordId: string; state: WordSchedulingState }[]) => void;
  onGenerateFromWords?: (wordIds: string[]) => void;
  onHome?: () => void;
  onOpenWord?: (wordId: string) => void;
}) {
  const breakdown: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of history) breakdown[e.rating] += 1;

  const lastByWord = new Map<string, RatingEvent>();
  for (const e of history) lastByWord.set(e.wordId, e); // later events overwrite → final state per word
  const lastEvents = [...lastByWord.values()];
  const advanced = lastEvents.filter((e) => e.stage === 'Consolidating' || e.stage === 'Mastered');
  const againEvents = lastEvents.filter((e) => e.rating === 1);
  const reviewedIds = lastEvents.map((e) => e.wordId);

  const leechMap = new Map<string, RatingEvent>();
  for (const e of history) if (e.lapses >= LEECH_LAPSE_THRESHOLD) leechMap.set(e.wordId, e);
  const leechEvents = [...leechMap.values()];

  return (
    <div style={centerWrapStyle}>
      <div style={completeCardStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 21, fontWeight: 600, color: colors.ink, textAlign: 'center' }}>
          復習が完了しました
        </div>

        {history.length === 0 ? (
          <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 10 }}>
            確認した語はありません。
          </div>
        ) : (
          <>
            <div style={breakdownRowStyle}>
              {RATINGS.map(({ rating, label, style }) => {
                const sk = RATE_SKIN[style];
                return (
                  <div key={rating} data-testid={`complete-count-${rating}`} style={breakdownCellStyle(sk)}>
                    <div style={{ fontFamily: fonts.num, fontSize: 22, fontWeight: 700, color: sk.fg }}>{breakdown[rating]}</div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.muted }}>{label}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 14 }}>
              定着へ進んだ語 {advanced.length} · 要復習 {againEvents.length}
            </div>

            {againEvents.length > 0 ? (
              <div
                data-testid="complete-again-list"
                style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.body, textAlign: 'center', marginTop: 8, lineHeight: 1.7 }}
              >
                要復習: {againEvents.map((e) => e.headword).join(' / ')}
              </div>
            ) : null}

            {leechEvents.length > 0 ? (
              <div data-testid="complete-leech" style={leechBoxStyle}>
                <div style={{ fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.terracottaDeep }}>
                  覚えにくい語 {leechEvents.length} 件 — 語源と記憶フックで覚え直す
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {leechEvents.map((e) => (
                    <button
                      key={e.wordId}
                      type="button"
                      data-testid={`leech-${e.wordId}`}
                      onClick={() => onOpenWord?.(e.wordId)}
                      style={leechChipStyle}
                    >
                      {e.headword}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
          {againEvents.length > 0 ? (
            <button
              type="button"
              data-testid="action-again"
              onClick={() => onRestartAgain(againEvents.map((e) => ({ wordId: e.wordId, state: e.simulated })))}
              style={primaryActionStyle}
            >
              「知らなかった」語をもう一度（10分ラダー消化）
            </button>
          ) : null}
          {reviewedIds.length > 0 ? (
            <button type="button" data-testid="action-generate" onClick={() => onGenerateFromWords?.(reviewedIds)} style={secondaryActionStyle}>
              この語群で文章を生成
            </button>
          ) : null}
          <button type="button" data-testid="action-home" onClick={() => onHome?.()} style={secondaryActionStyle}>
            ホームへ
          </button>
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
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
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

/** Small "Space" key hint next to the reveal button (D-8 keyboard grading). */
const revealKeyHintStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: colors.muted,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: 4,
  padding: '1px 6px',
};

/** The 1–4 key badge shown on each difficulty button (D-8 keyboard grading). */
const rateKeyHintStyle = (sk: RateSkin): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 4,
  fontFamily: fonts.num,
  fontSize: 10.5,
  fontWeight: 700,
  color: sk.fg,
  border: `1px solid ${sk.border}`,
});

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

const sessionToolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 24px',
  borderBottom: `1px solid ${colors.dividerSection}`,
};

const toolbarButtonStyle = (enabled: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  color: enabled ? colors.muted : colors.faint,
  background: 'transparent',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '5px 12px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
});

const completeCardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  boxShadow: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  padding: '32px 34px',
  textAlign: 'left',
};

const breakdownRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
  marginTop: 20,
};

const breakdownCellStyle = (sk: RateSkin): CSSProperties => ({
  textAlign: 'center',
  background: sk.bg,
  border: `1px solid ${sk.border}`,
  borderRadius: radius.control,
  padding: '10px 4px',
});

const leechBoxStyle: CSSProperties = {
  marginTop: 16,
  background: colors.surfaceCard,
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '14px 16px',
};

const leechChipStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12.5,
  color: colors.terracottaDeep,
  background: colors.surfaceCard,
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.chip,
  padding: '5px 12px',
  cursor: 'pointer',
};

const primaryActionStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 14,
  fontWeight: 600,
  color: '#FFFFFF',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.control,
  padding: '12px 16px',
  cursor: 'pointer',
};

const secondaryActionStyle: CSSProperties = {
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

/**
 * L4 — route containers: the thin wiring that connects each presentational screen to the
 * live data and flow controllers via the AppContext container. This is where tasks 10.1–10.4
 * surface in the UI:
 *   - SetupRoute → runGenerationPipeline (Flow 1: generate→validate→persist→render→TTS).
 *   - ReadingRoute → applyRecallSignal on a word tap (Flow 3: reading-time recall).
 *   - ReviewRoute → applyReviewRating on a rating (Flow 2: reschedule→log→reproject).
 *   - DashboardRoute / WordbookRoute → live snapshots via useLiveQuery (reactive reads).
 * Reads are reactive (`useLiveQuery`) so any repository write re-renders immediately.
 */

import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from 'zustand';
import type { CSSProperties, ReactNode } from 'react';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { SetupScreen, type CandidateWord } from '../setup/SetupScreen';
import { ReadingScreen } from '../reading/ReadingScreen';
import { ReviewSession, type ReviewItem } from '../review/ReviewSession';
import { WordbookScreen, type WordbookEntry } from '../wordbook/WordbookScreen';
import { WordDetailCard } from '../wordcard/WordDetailCard';
import { useContainer } from './AppContext';
import { useWordData } from '../../state/queries/contentQueries';
import { loadDashboardSnapshot } from '../../state/controllers/dashboardController';
import { runGenerationPipeline } from '../../state/controllers/generationController';
import { applyRecallSignal } from '../../state/controllers/recallController';
import { applyReviewRating } from '../../state/controllers/reviewController';
import { restoreReadingSession } from '../../state/controllers/sessionBootstrap';
import { sessionPlanner } from '../../domain/session/sessionPlanner';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { colors, fonts } from '../theme/tokens';
import type { MasteryStage, Rating, SetupConfig, WordSchedulingState } from '../../types/domain';

const CANDIDATE_LIMIT = 12;

/** Lightweight hydration/loading gate shown until the first live read resolves. */
function ScreenSkeleton() {
  return (
    <div style={skeletonStyle} aria-busy="true">
      読み込み中…
    </div>
  );
}

// ── Dashboard (10.3 reflection, 9.3) ─────────────────────────────────────────

export function DashboardRoute() {
  const c = useContainer();
  const navigate = useNavigate();

  const snapshot = useLiveQuery(
    () =>
      loadDashboardSnapshot(
        {
          loadStates: c.loadStates,
          progress: c.repos.progress,
          reviewLog: c.repos.reviewLog,
          passages: c.repos.passages,
        },
        c.userId,
        c.now(),
      ),
    [c],
  );

  if (!snapshot) return <ScreenSkeleton />;

  // Resume the most-recent in-progress passage at its saved position (10.4 restore).
  const resume = async (): Promise<void> => {
    await restoreReadingSession({ passages: c.repos.passages, progress: c.repos.progress, session: c.session }, c.userId);
    navigate('/read');
  };

  return (
    <DashboardScreen
      snapshot={snapshot}
      now={c.now()}
      onContinue={() => void resume()}
      onStartReview={() => navigate('/review')}
      onOpenPassage={() => void resume()}
    />
  );
}

// ── Setup → generate (10.1, Flow 1) ──────────────────────────────────────────

export function SetupRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const lastSetup = useStore(c.settings, (s) => s.lastSetup);

  const candidates =
    useLiveQuery<CandidateWord[]>(async () => {
      const states = await sessionPlanner.selectCandidates(c.repos.scheduling, c.userId, c.now(), CANDIDATE_LIMIT);
      return states.map((s) => ({ wordId: s.wordId, surface: s.wordId }));
    }, [c]) ?? [];

  const onGenerate = async (setup: SetupConfig): Promise<void> => {
    c.settings.getState().setLastSetup(setup);
    const outcome = await runGenerationPipeline(
      {
        createOrchestrator: c.createOrchestrator,
        scheduling: c.repos.scheduling,
        passages: c.repos.passages,
        progress: c.repos.progress,
        timingMaps: c.repos.timingMaps,
        tts: c.tts,
        session: c.session,
        player: c.player,
        now: c.now,
        genId: c.genId,
        voiceId: c.voiceId,
      },
      setup,
      c.userId,
    );
    if (outcome.ok) navigate('/read');
  };

  return <SetupScreen candidates={candidates} initial={lastSetup} onGenerate={(s) => void onGenerate(s)} />;
}

// ── Reading → recall on lookup (10.2, Flow 3) ────────────────────────────────

export function ReadingRoute() {
  const c = useContainer();

  const onLookup = (wordId: string): void => {
    void applyRecallSignal(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      { kind: 'lookup', wordId, at: c.now() },
    );
  };

  return (
    <ReadingScreen
      onLookup={onLookup}
      renderWordDetail={(wordId, onClose) => <WordDetailRoute wordId={wordId} onClose={onClose} />}
    />
  );
}

// ── Review → rate (10.3, Flow 2) ─────────────────────────────────────────────

/** Minimal review item from scheduling state; WordData enrichment is best-effort UI. */
function reviewItemFromState(state: WordSchedulingState): ReviewItem {
  return {
    state,
    headword: state.wordId,
    context: { before: '', target: state.wordId, after: '' },
    answer: { meaningJa: '' },
  };
}

export function ReviewRoute() {
  const c = useContainer();
  const navigate = useNavigate();

  const queue = useLiveQuery<ReviewItem[]>(async () => {
    const states = await sessionPlanner.planReviewQueue(c.repos.scheduling, c.userId, c.now());
    return states.map(reviewItemFromState);
  }, [c]);

  if (!queue) return <ScreenSkeleton />;

  const onRate = (wordId: string, rating: Rating): void => {
    void applyReviewRating(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      wordId,
      rating,
      c.now(),
    );
  };

  return <ReviewSession queue={queue} now={c.now()} onRate={onRate} onComplete={() => navigate('/')} />;
}

// ── Wordbook (live list, 11.x) ───────────────────────────────────────────────

export function WordbookRoute() {
  const c = useContainer();

  const words =
    useLiveQuery<WordbookEntry[]>(async () => {
      const [states, cache] = await Promise.all([c.loadStates(c.userId), c.repos.wordCache.all(c.userId)]);
      const byId = new Map(cache.map((w) => [w.wordId, w]));
      return states.map((s) => {
        const data = byId.get(s.wordId);
        const stage: MasteryStage = masteryProjector.deriveMastery(s, { kind: 'none' });
        return {
          wordId: s.wordId,
          headword: data?.headword ?? s.wordId,
          gloss: data?.core.meaningsJa[0],
          stage,
        };
      });
    }, [c]) ?? [];

  return (
    <WordbookScreen
      words={words}
      renderWordDetail={(wordId, onClose) => <WordDetailRoute wordId={wordId} onClose={onClose} />}
    />
  );
}

// ── Shared word-detail overlay (8.4) ─────────────────────────────────────────

function WordDetailRoute({ wordId, onClose }: { wordId: string; onClose: () => void }): ReactNode {
  const c = useContainer();
  const { data: word } = useWordData(c.content, wordId);
  const stage = useLiveQuery<MasteryStage | undefined>(async () => {
    const s = await c.repos.scheduling.get(c.userId, wordId);
    return s ? masteryProjector.deriveMastery(s, { kind: 'none' }) : undefined;
  }, [c, wordId]);

  if (!word) {
    return (
      <div style={detailLoadingStyle}>
        <div style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.ink }}>{wordId}</div>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>単語情報を読み込み中…</div>
        <button type="button" onClick={onClose} style={closeButtonStyle}>
          閉じる
        </button>
      </div>
    );
  }
  return <WordDetailCard word={word} stage={stage} onClose={onClose} />;
}

const skeletonStyle: CSSProperties = {
  padding: '60px 40px',
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.faint,
  textAlign: 'center',
};

const detailLoadingStyle: CSSProperties = {
  background: colors.surfaceCard,
  borderRadius: 16,
  padding: '32px 36px',
  textAlign: 'center',
  minWidth: 280,
};

const closeButtonStyle: CSSProperties = {
  marginTop: 18,
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: 8,
  padding: '8px 18px',
  cursor: 'pointer',
};

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
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { SetupScreen, type CandidateWord } from '../setup/SetupScreen';
import { ReadingScreen } from '../reading/ReadingScreen';
import { NoticeRail } from '../reading/NoticeRail';
import { StudyWordsList, type StudyWord } from '../reading/StudyWordsList';
import { ReviewSession, type ReviewItem } from '../review/ReviewSession';
import { WordbookScreen, type WordbookEntry } from '../wordbook/WordbookScreen';
import { WordDetailCard } from '../wordcard/WordDetailCard';
import { useContainer } from './AppContext';
import type { Container } from './container';
import { useWordData } from '../../state/queries/contentQueries';
import { loadDashboardSnapshot } from '../../state/controllers/dashboardController';
import { runGenerationPipeline } from '../../state/controllers/generationController';
import { applyRecallSignal } from '../../state/controllers/recallController';
import { applyReviewRating } from '../../state/controllers/reviewController';
import { restoreReadingSession } from '../../state/controllers/sessionBootstrap';
import { sessionPlanner } from '../../domain/session/sessionPlanner';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { colors, fonts } from '../theme/tokens';
import type { IndexedPassage, MasteryStage, Rating, SetupConfig, WordData, WordSchedulingState } from '../../types/domain';

const CANDIDATE_LIMIT = 12;

function stripCacheNamespace(data: WordData): WordData {
  const copy = { ...data } as WordData & { userId?: unknown };
  delete copy.userId;
  return copy;
}

async function loadAndCacheWordData(c: Container, wordId: string): Promise<WordData> {
  const cached = await c.repos.wordCache.get(c.userId, wordId);
  if (cached) return stripCacheNamespace(cached);
  const data = await c.content.getWordData(wordId);
  try {
    await c.repos.wordCache.put(c.userId, data);
  } catch {
    // WordData still powers the current screen; cache persistence is a best-effort fast path.
  }
  return data;
}

async function loadWordDataMap(c: Container, wordIds: string[]): Promise<Record<string, WordData>> {
  const unique = [...new Set(wordIds)];
  const entries = await Promise.all(
    unique.map(async (wordId) => {
      try {
        return [wordId, await loadAndCacheWordData(c, wordId)] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, WordData] => entry !== null));
}

function generationErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'kind' in error) {
    const kind = String((error as { kind: unknown }).kind);
    if (kind === 'refusal') return '生成が拒否されました。条件を少し変えてもう一度試してください。';
    if (kind === 'max_tokens') return '文章が長すぎて生成が途中で止まりました。文章の長さを短くしてください。';
    if (kind === 'validation_exhausted') return '生成文の検証に失敗しました。対象単語やテーマを調整してください。';
    if (kind === 'rate_limited') return '生成リクエストが混み合っています。少し待ってから再試行してください。';
    if (kind === 'unavailable' || kind === 'network') return '生成サービスに接続できませんでした。時間をおいて再試行してください。';
  }
  return '文章生成に失敗しました。条件を確認してもう一度試してください。';
}

function uniqueStudyWords(passage: IndexedPassage): StudyWord[] {
  const seen = new Set<string>();
  const words: StudyWord[] = [];
  for (const span of passage.source.targetSpans) {
    if (seen.has(span.wordId)) continue;
    seen.add(span.wordId);
    words.push({ wordId: span.wordId, surface: span.surface || span.wordId, reappearCount: span.reappearInfo?.count });
  }
  return words;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitExample(example: string, target: string): ReviewItem['context'] {
  const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
  const match = re.exec(example);
  if (!match) {
    return { before: 'In a fresh context, ', target, after: ' shows how the idea works in practice.' };
  }
  return {
    before: example.slice(0, match.index),
    target: example.slice(match.index, match.index + match[0].length),
    after: example.slice(match.index + match[0].length),
  };
}

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
  const voiceId = useStore(c.settings, (s) => s.voiceId);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const candidates =
    useLiveQuery<CandidateWord[]>(async () => {
      const states = await sessionPlanner.selectCandidates(c.repos.scheduling, c.userId, c.now(), CANDIDATE_LIMIT);
      return states.map((s) => ({ wordId: s.wordId, surface: s.wordId }));
    }, [c]) ?? [];

  const onGenerate = async (setup: SetupConfig): Promise<void> => {
    if (generating) return;
    setGenerating(true);
    setGenerationError(null);
    c.settings.getState().setLastSetup(setup);
    try {
      const wordData = await loadWordDataMap(c, setup.targetWordIds);
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
          voiceId: voiceId || c.voiceId,
          wordData,
        },
        setup,
        c.userId,
      );
      if (outcome.ok) navigate('/read');
      else setGenerationError(generationErrorMessage(outcome.error));
    } catch (error) {
      setGenerationError(generationErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SetupScreen
      candidates={candidates}
      initial={lastSetup}
      generating={generating}
      generationError={generationError}
      onGenerate={(s) => void onGenerate(s)}
    />
  );
}

// ── Reading → recall on lookup (10.2, Flow 3) ────────────────────────────────

export function ReadingRoute() {
  const c = useContainer();
  const passage = useStore(c.session, (s) => s.passage);

  const studyWords = useLiveQuery<StudyWord[] | undefined>(async () => {
    if (!passage) return undefined;
    const words = uniqueStudyWords(passage);
    return Promise.all(
      words.map(async (word) => {
        const state = await c.repos.scheduling.get(c.userId, word.wordId);
        return {
          ...word,
          stage: state ? masteryProjector.deriveMastery(state, { kind: 'none' }) : undefined,
          reappearCount: state?.reappearCount ?? word.reappearCount,
        };
      }),
    );
  }, [c, passage?.passageId]);

  const rail = passage ? (
    <>
      <NoticeRail passage={passage} />
      <StudyWordsList words={studyWords ?? uniqueStudyWords(passage)} />
    </>
  ) : undefined;

  const onLookup = (wordId: string): void => {
    void applyRecallSignal(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      { kind: 'lookup', wordId, at: c.now() },
    );
  };

  const completeReading = async (): Promise<void> => {
    const active = c.session.getState().passage;
    if (!active) return;
    const now = c.now();
    await Promise.all(
      uniqueStudyWords(active).map((word) =>
        applyRecallSignal(
          { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
          c.userId,
          { kind: 'read_through', wordId: word.wordId, at: now },
        ),
      ),
    );
    c.session.getState().updateProgress(Math.max(0, active.sentences.length - 1));
    c.session.getState().markCompleted(now);
    const progress = c.session.getState().toReadingProgress(c.userId);
    if (progress) await c.repos.progress.upsert(progress);
  };

  return (
    <ReadingScreen
      passage={passage ?? undefined}
      rail={rail}
      onLookup={onLookup}
      onCompleteReading={() => void completeReading()}
      renderWordDetail={(wordId, onClose) => <WordDetailRoute wordId={wordId} onClose={onClose} />}
    />
  );
}

// ── Review → rate (10.3, Flow 2) ─────────────────────────────────────────────

/** Review item from scheduling state plus best-effort WordData enrichment. */
function reviewItemFromState(state: WordSchedulingState, word?: WordData): ReviewItem {
  const headword = word?.headword ?? state.wordId;
  const example = word?.core.examples.find((ex) => new RegExp(`\\b${escapeRegExp(headword)}\\b`, 'i').test(ex.en));
  return {
    state,
    headword,
    ipa: word?.ipa,
    context: example ? splitExample(example.en, headword) : splitExample('', headword),
    answer: {
      meaningJa: word?.core.meaningsJa.join(' / ') || '意味データを取得できませんでした',
      detailJa: word?.core.synonymNuances[0],
      collocations: word?.core.collocations,
      register: word?.register,
      synonyms: word?.more?.semanticNetwork?.synonyms,
    },
  };
}

export function ReviewRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);

  const states = useLiveQuery<WordSchedulingState[]>(async () => {
    return sessionPlanner.planReviewQueue(c.repos.scheduling, c.userId, c.now());
  }, [c]);

  useEffect(() => {
    if (!states) return;
    let cancelled = false;
    setQueue(null);
    void Promise.all(
      states.map(async (state) => {
        try {
          return reviewItemFromState(state, await loadAndCacheWordData(c, state.wordId));
        } catch {
          return reviewItemFromState(state);
        }
      }),
    ).then((items) => {
      if (!cancelled) setQueue(items);
    });
    return () => {
      cancelled = true;
    };
  }, [c, states]);

  if (!states || !queue) return <ScreenSkeleton />;

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

  useEffect(() => {
    if (word) void c.repos.wordCache.put(c.userId, word);
  }, [c, word]);

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

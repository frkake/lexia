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

import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from 'zustand';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { type CandidateWord } from '../setup/SetupScreen';
import { HomeScreen } from '../home/HomeScreen';
import { LibraryScreen } from '../library/LibraryScreen';
import { StoryDirectoryScreen, type StoryChapterRow } from '../story/StoryDirectoryScreen';
import { StoryPlanReview } from '../setup/StoryPlanReview';
import { ReadingScreen } from '../reading/ReadingScreen';
import { StudyWordsList, type StudyWord } from '../reading/StudyWordsList';
import { resolveFeatureFlags } from './featureFlags';
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
import { openPassage, restoreReadingSession } from '../../state/controllers/sessionBootstrap';
import { sessionPlanner } from '../../domain/session/sessionPlanner';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { examScale } from '../../domain/difficulty/examScale';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { colors, fonts, radius } from '../theme/tokens';
import type { IndexedPassage, MasteryStage, Rating, SetupConfig, StoryPlan, StoryRecord, WordData, WordSchedulingState } from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

const CANDIDATE_LIMIT = 12;

/** Reader URL for a passage: story chapters are /s/:storyId/:chapterIndex, articles are /p/:id. */
function readerPathFor(passageId: string, storyRef?: { storyId: string; chapterIndex: number }): string {
  return storyRef ? `/s/${storyRef.storyId}/${storyRef.chapterIndex}` : `/p/${passageId}`;
}

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

/**
 * When the learner starts from a level + theme without hand-picking any target words, ask the
 * proxy to propose new vocabulary to teach (so the passage actually has new words / collocations
 * to learn). Falls back to the original (empty) selection if suggestion is unavailable or fails.
 */
async function resolveTargetWordIds(c: Container, setup: SetupConfig): Promise<string[]> {
  if (setup.targetWordIds.length > 0 || !c.content.suggestWords) return setup.targetWordIds;
  try {
    const suggested = await c.content.suggestWords({
      level: examScale.examToCefr(setup.examTarget),
      intent: setup.intent,
      count: lengthSpec.newWordsFor(setup.wordTarget, setup.newWordRatio),
      exclude: setup.excludedWordIds,
    });
    return suggested.length > 0 ? suggested : setup.targetWordIds;
  } catch {
    return setup.targetWordIds;
  }
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

function clampStoryWordTarget(wordTarget: number): number {
  const range = lengthSpec.wordRange('long_story');
  return Math.min(range.max, Math.max(range.min, wordTarget));
}

function storyContinuationSetup(setup: SetupConfig, passage: IndexedPassage, plan: StoryPlan): SetupConfig {
  return {
    ...setup,
    intent: passage.source.meta.intent,
    contentType: 'long_story',
    wordTarget: clampStoryWordTarget(setup.wordTarget),
    storyOptions: {
      genre: plan.genre,
      ...(plan.homage?.title ? { homageTitle: plan.homage.title } : {}),
    },
  };
}

function chapterIndexOf(record: PassageRecord): number {
  return record.passage.meta.storyRef?.chapterIndex ?? 0;
}

function indexedFromRecord(record: PassageRecord): IndexedPassage {
  return tokenizer.index(record.passageId, record.passage);
}

function priorSummaryJa(chapters: PassageRecord[], throughChapterIndex: number): string | undefined {
  const lines = chapters
    .filter((chapter) => chapterIndexOf(chapter) <= throughChapterIndex)
    .sort((a, b) => chapterIndexOf(a) - chapterIndexOf(b))
    .slice(-4)
    .map((chapter) => {
      const chapterNo = chapterIndexOf(chapter) + 1;
      const translations = chapter.passage.sentences
        .map((sentence) => sentence.translationJa.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' ');
      return `第${chapterNo}章「${chapter.passage.meta.title}」: ${translations || '本文生成済み。'}`;
    });
  return lines.length > 0 ? lines.join('\n') : undefined;
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

// ── Home → generate (10.1, Flow 1) ───────────────────────────────────────────

export function HomeRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const lastSetup = useStore(c.settings, (s) => s.lastSetup);
  const voiceId = useStore(c.settings, (s) => s.voiceId);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Setup-open auto-suggestion (Requirement 5.1): ask the WordSuggestionService for ABC-ordered
  // "next to learn" words (introduced/excluded removed), surfacing a shortfall notice when the
  // gateway can't fill the request. Falls back to the due/weak candidates if suggestion yields none.
  const [candidates, setCandidates] = useState<CandidateWord[]>([]);
  const [suggestionShortfall, setSuggestionShortfall] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await c.suggestions.suggest(
          {
            userId: c.userId,
            level: examScale.examToCefr(lastSetup.examTarget),
            intent: lastSetup.intent,
            excludedWordIds: lastSetup.excludedWordIds ?? [],
            count: CANDIDATE_LIMIT,
          },
          c.repos.scheduling,
        );
        if (cancelled) return;
        if (result.candidates.length > 0) {
          setCandidates(result.candidates);
          setSuggestionShortfall(
            result.shortfall ? '提案できる新しい単語が不足しています。手動で追加できます。' : null,
          );
          return;
        }
        // Suggestion empty (gateway unavailable / exhausted): fall back to due/weak candidates.
        const states = await sessionPlanner.selectCandidates(c.repos.scheduling, c.userId, c.now(), CANDIDATE_LIMIT);
        if (cancelled) return;
        setCandidates(states.map((s) => ({ wordId: s.wordId, surface: s.wordId })));
        setSuggestionShortfall(
          result.shortfall?.reason === 'gateway_unavailable'
            ? '単語提案サービスに接続できませんでした。手動で追加できます。'
            : null,
        );
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the difficulty/intent seed changes.
  }, [c, lastSetup.examTarget, lastSetup.intent, lastSetup.excludedWordIds]);

  // Story confirmation gate (Requirement 6.3): when a story is generated, hold the plan for the
  // learner to confirm before any chapter body is produced. Only active when storyMode is on.
  const { storyMode, characterIllustrations } = resolveFeatureFlags();
  const [pendingPlan, setPendingPlan] = useState<StoryPlan | null>(null);
  const [pendingSetup, setPendingSetup] = useState<SetupConfig | null>(null);
  // True while character portraits stream in on the confirmation gate (6.8); enrichment only.
  const [illustrating, setIllustrating] = useState(false);
  const activeIllustrationRequest = useRef(0);

  /** Run the standard article generate → validate → persist → render pipeline. */
  const runArticlePipeline = async (setup: SetupConfig): Promise<void> => {
    const targetWordIds = await resolveTargetWordIds(c, setup);
    const effectiveSetup = targetWordIds === setup.targetWordIds ? setup : { ...setup, targetWordIds };
    const wordData = await loadWordDataMap(c, targetWordIds);
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
      effectiveSetup,
      c.userId,
    );
    if (outcome.ok && outcome.passageId) navigate(`/p/${outcome.passageId}`);
    else if (!outcome.ok) setGenerationError(generationErrorMessage(outcome.error));
  };

  const onGenerate = async (setup: SetupConfig): Promise<void> => {
    if (generating) return;
    setGenerating(true);
    setGenerationError(null);
    c.settings.getState().setLastSetup(setup);
    try {
      // Story path: generate the plan and STOP at the confirmation gate (no body yet, 6.3).
      if (storyMode && setup.contentType !== 'article') {
        const planned = await c.storyPlanner.planStory({
          contentType: setup.contentType,
          genre: setup.storyOptions?.genre ?? 'fantasy',
          homageTitle: setup.storyOptions?.homageTitle,
          intent: setup.intent,
          level: examScale.examToCefr(setup.examTarget),
        });
        if (!planned.ok) {
          setGenerationError(generationErrorMessage(planned.error));
          return;
        }
        // Show the plan immediately (gate is up), then stream in character portraits (6.8). Illustration
        // is enrichment: it never blocks confirmation, so failures are swallowed and just leave placeholders.
        setPendingSetup(setup);
        setPendingPlan(planned.value);
        activeIllustrationRequest.current += 1;
        setIllustrating(false);
        if (characterIllustrations) {
          const illustrationRequest = activeIllustrationRequest.current;
          setIllustrating(true);
          void c.storyPlanner
            .illustrateCharacters(planned.value, (index, illustrationUrl) => {
              if (activeIllustrationRequest.current !== illustrationRequest) return;
              setPendingPlan((prev) => {
                if (!prev || prev.storyId !== planned.value.storyId) return prev;
                const characters = prev.characters.map((ch, i) => (i === index ? { ...ch, illustrationUrl } : ch));
                return { ...prev, characters };
              });
            })
            .finally(() => {
              if (activeIllustrationRequest.current === illustrationRequest) {
                setIllustrating(false);
              }
            });
        }
        return;
      }
      await runArticlePipeline(setup);
    } catch (error) {
      setGenerationError(generationErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  // Confirmation gate passed: persist the plan, then generate + persist the first chapter and read it.
  const onConfirmPlan = async (plan: StoryPlan): Promise<void> => {
    if (generating) return;
    if (!pendingSetup) {
      setGenerationError('執筆に必要な設定が見つかりません。やり直してください。');
      return;
    }
    setGenerating(true);
    setGenerationError(null);
    try {
      await c.storyPlanner.confirmPlan(c.userId, plan);
      const setup = pendingSetup;
      const targetWordIds = await resolveTargetWordIds(c, setup);
      const effectiveSetup = targetWordIds === setup.targetWordIds ? setup : { ...setup, targetWordIds };
      const wordData = await loadWordDataMap(c, targetWordIds);
      const chapterIndex = 0;
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
        effectiveSetup,
        c.userId,
        {
          passageId: `${plan.storyId}:${chapterIndex}`,
          storyContext: { storyId: plan.storyId, chapterIndex, plan },
        },
      );
      if (!outcome.ok) {
        setGenerationError(generationErrorMessage(outcome.error));
        return;
      }
      activeIllustrationRequest.current += 1;
      setPendingPlan(null);
      setPendingSetup(null);
      navigate(`/s/${plan.storyId}/${chapterIndex}`);
    } catch (error) {
      setGenerationError(generationErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  const snapshot = useLiveQuery(
    () =>
      loadDashboardSnapshot(
        { loadStates: c.loadStates, progress: c.repos.progress, reviewLog: c.repos.reviewLog, passages: c.repos.passages },
        c.userId,
        c.now(),
      ),
    [c],
  );

  const resume = async (): Promise<void> => {
    await restoreReadingSession({ passages: c.repos.passages, progress: c.repos.progress, session: c.session }, c.userId);
    const active = c.session.getState().passage;
    if (active) navigate(readerPathFor(active.passageId, active.source.meta.storyRef));
  };

  if (pendingPlan) {
    return (
      <StoryPlanReview
        plan={pendingPlan}
        illustrating={illustrating}
        confirming={generating}
        confirmError={generationError}
        onConfirm={(p) => void onConfirmPlan(p)}
        onCancel={() => {
          activeIllustrationRequest.current += 1;
          setPendingPlan(null);
          setPendingSetup(null);
          setIllustrating(false);
        }}
      />
    );
  }

  return (
    <HomeScreen
      setup={{
        candidates,
        suggestionShortfall,
        initial: lastSetup,
        generating,
        generationError,
        onGenerate: (s) => void onGenerate(s),
      }}
      snapshot={snapshot ?? undefined}
      now={c.now()}
      onContinue={() => void resume()}
      onStartReview={() => navigate('/review')}
      onOpenPassage={() => void resume()}
    />
  );
}

// ── Reading → recall on lookup (10.2, Flow 3) ────────────────────────────────

export function ReadingRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const params = useParams();
  const targetPassageId =
    params.storyId && params.chapterIndex !== undefined
      ? `${params.storyId}:${params.chapterIndex}`
      : params.passageId;
  const passage = useStore(c.session, (s) => s.passage);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!targetPassageId) return;
    if (passage?.passageId === targetPassageId) {
      setNotFound(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const opened = await openPassage(
        { passages: c.repos.passages, progress: c.repos.progress, session: c.session },
        c.userId,
        targetPassageId,
      );
      if (!cancelled) setNotFound(opened === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [c, targetPassageId, passage?.passageId]);

  const voiceId = useStore(c.settings, (s) => s.voiceId);
  const lastSetup = useStore(c.settings, (s) => s.lastSetup);
  const [generatingNextChapter, setGeneratingNextChapter] = useState(false);
  const [nextChapterError, setNextChapterError] = useState<string | null>(null);

  const storyDetails = useLiveQuery<
    { story: StoryRecord; chapters: PassageRecord[] } | null | undefined
  >(async () => {
    const storyId = passage?.source.meta.storyRef?.storyId;
    if (!storyId) return null;
    const story = await c.repos.stories.get(storyId);
    if (!story || story.userId !== c.userId) return null;
    const chapters = story.plan.contentType === 'long_story' ? await c.repos.passages.byStory(c.userId, storyId) : [];
    return { story, chapters };
  }, [c, passage?.passageId, passage?.source.meta.storyRef?.storyId]);

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

  // The NoticeRail is owned by ReadingScreen (it receives the line-anchor positions for the new
  // layout); the route only supplies the live, mastery-enriched study-words list beneath it.
  const rail = passage ? <StudyWordsList words={studyWords ?? uniqueStudyWords(passage)} /> : undefined;

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

  const generateNextStoryChapter = async (): Promise<void> => {
    const active = c.session.getState().passage;
    const ref = active?.source.meta.storyRef;
    const continuation = storyDetails?.story.plan.contentType === 'long_story' ? storyDetails : null;
    if (!active || !ref || !continuation || generatingNextChapter) return;

    setGeneratingNextChapter(true);
    setNextChapterError(null);
    try {
      const nextIndex = ref.chapterIndex + 1;
      const existing = continuation.chapters.find((chapter) => chapterIndexOf(chapter) === nextIndex);
      if (existing) {
        const indexed = indexedFromRecord(existing);
        c.session.getState().startPassage(indexed, c.now());
        const progress = c.session.getState().toReadingProgress(c.userId);
        if (progress) await c.repos.progress.upsert(progress);
        c.player.getState().setStatus('unavailable');
        return;
      }

      let plan = continuation.story.plan;
      const summary = priorSummaryJa(continuation.chapters, ref.chapterIndex);
      if (nextIndex >= plan.chapters.length) {
        const extended = await c.storyPlanner.extendPlan(plan, nextIndex, summary);
        if (!extended.ok) {
          setNextChapterError('プロットを延長できませんでした。時間をおいて再試行してください。');
          return;
        }
        plan = extended.value;
        await c.repos.stories.put({ ...continuation.story, plan });
      }

      const setup = storyContinuationSetup(lastSetup, active, plan);
      const targetWordIds = await resolveTargetWordIds(c, setup);
      const effectiveSetup = targetWordIds === setup.targetWordIds ? setup : { ...setup, targetWordIds };
      const wordData = await loadWordDataMap(c, targetWordIds);
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
        effectiveSetup,
        c.userId,
        {
          passageId: `${plan.storyId}:${nextIndex}`,
          storyContext: {
            storyId: plan.storyId,
            chapterIndex: nextIndex,
            plan,
            ...(summary ? { priorSummaryJa: summary } : {}),
          },
        },
      );
      if (!outcome.ok) {
        setNextChapterError(generationErrorMessage(outcome.error));
        return;
      }
      navigate(`/s/${plan.storyId}/${nextIndex}`);
    } catch {
      setNextChapterError('続きを生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setGeneratingNextChapter(false);
    }
  };

  if (notFound) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>文章が見つかりません</div>
        <button type="button" onClick={() => navigate('/library')} style={notFoundButtonStyle}>
          文章一覧へ
        </button>
      </div>
    );
  }

  // The display-improvement cluster (Requirements 1–4) is shipped, so the reading-layout flag is
  // on by default; resolveFeatureFlags still allows an override to disable it.
  const { newReadingLayout } = resolveFeatureFlags();

  return (
    <ReadingScreen
      passage={passage ?? undefined}
      rail={rail}
      newLayout={newReadingLayout}
      onLookup={onLookup}
      onCompleteReading={() => void completeReading()}
      storyPlan={storyDetails?.story.plan}
      onGenerateNextChapter={
        storyDetails?.story.plan.contentType === 'long_story' ? () => void generateNextStoryChapter() : undefined
      }
      generatingNextChapter={generatingNextChapter}
      nextChapterError={nextChapterError}
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

// ── Library (passage list) ────────────────────────────────────────────────────

export function LibraryRoute() {
  const c = useContainer();
  const navigate = useNavigate();

  const passages = useLiveQuery(() => c.repos.passages.all(c.userId), [c]);
  const storyTitles = useLiveQuery(async () => {
    const stories = await c.repos.stories.recent(c.userId, 200);
    return Object.fromEntries(stories.map((s) => [s.storyId, s.plan.titleJa] as const));
  }, [c]);

  if (!passages) return <ScreenSkeleton />;

  return (
    <LibraryScreen
      passages={passages}
      storyTitles={storyTitles ?? {}}
      onOpenArticle={(passageId) => navigate(`/p/${passageId}`)}
      onOpenStory={(storyId) => navigate(`/s/${storyId}`)}
    />
  );
}

// ── Story directory ───────────────────────────────────────────────────────────

export function StoryDirectoryRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const params = useParams();
  const storyId = params.storyId ?? '';

  const data = useLiveQuery(async () => {
    const story = await c.repos.stories.get(storyId);
    if (!story || story.userId !== c.userId) return null;
    const chapters = await c.repos.passages.byStory(c.userId, storyId);
    const generated = new Set(chapters.map((ch) => ch.passage.meta.storyRef?.chapterIndex ?? 0));
    const rows: StoryChapterRow[] = story.plan.chapters.map((ch) => ({
      chapterIndex: ch.index,
      headingJa: ch.headingJa,
      generated: generated.has(ch.index),
    }));
    return { plan: story.plan, rows };
  }, [c, storyId]);

  if (data === undefined) return <ScreenSkeleton />;
  if (data === null) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>物語が見つかりません</div>
        <button type="button" onClick={() => navigate('/library')} style={notFoundButtonStyle}>
          文章一覧へ
        </button>
      </div>
    );
  }

  return (
    <StoryDirectoryScreen
      plan={data.plan}
      chapters={data.rows}
      onOpenChapter={(chapterIndex) => navigate(`/s/${storyId}/${chapterIndex}`)}
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

const notFoundStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  padding: '80px 24px',
  background: colors.surfacePage,
};

const notFoundButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '8px 18px',
  cursor: 'pointer',
};

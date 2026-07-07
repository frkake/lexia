/**
 * L4 — route containers: the thin wiring that connects each presentational screen to the
 * live data and flow controllers via the AppContext container. This is where tasks 10.1–10.4
 * surface in the UI:
 *   - HomeRoute → runGenerationPipeline (Flow 1: generate→validate→persist→render→TTS) + dashboard summary.
 *   - ReadingRoute → opens a passage by URL (openPassage) + read-through recall on completion.
 *   - WordDetailRoute → explicit「知らなかった」marks use the review rating path (Again).
 *   - ReviewRoute → applyReviewRating on a rating (Flow 2: reschedule→log→reproject).
 *   - LibraryRoute / StoryDirectoryRoute / StoryCharacterDetailRoute / WordbookRoute → live snapshots via useLiveQuery (reactive reads).
 * Reads are reactive (`useLiveQuery`) so any repository write re-renders immediately.
 */

import { useLocation, useNavigate, useParams, useRouteError, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from 'zustand';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { type CandidateWord } from '../setup/SetupScreen';
import { HomeScreen } from '../home/HomeScreen';
import { LibraryScreen } from '../library/LibraryScreen';
import { StoryDirectoryScreen, type StoryChapterRow } from '../story/StoryDirectoryScreen';
import { StoryCharacterDetailScreen } from '../story/StoryCharacterDetailScreen';
import { StoryPlanReview } from '../setup/StoryPlanReview';
import { ReadingScreen, type ReadingCompletionSummary } from '../reading/ReadingScreen';
import type { StudyWord } from '../reading/StudyWordsList';
import { resolveFeatureFlags } from './featureFlags';
import { ReviewSession, type ReviewItem } from '../review/ReviewSession';
import { ReviewStartGate } from '../review/ReviewStartGate';
import { WordbookScreen, type WordbookEntry, type WordSort } from '../wordbook/WordbookScreen';
import { DataManagementScreen } from '../settings/DataManagementScreen';
import { GenerationSettingsScreen } from '../settings/GenerationSettingsScreen';
import { WordDetailCard } from '../wordcard/WordDetailCard';
import { ModalOverlay } from '../shared/ModalOverlay';
import { DUE_LIST_LIMIT } from '../dashboard/DashboardScreen';
import { useContainer } from './AppContext';
import type { Container } from './container';
import { useWordData } from '../../state/queries/contentQueries';
import { loadAndCacheWordData } from '../../state/controllers/wordDataCache';
import { loadDashboardSnapshot } from '../../state/controllers/dashboardController';
import {
  backfillPassageIllustration,
  buildPassageIllustrationRequest,
  runGenerationPipeline,
} from '../../state/controllers/generationController';
import { applyRecallSignal } from '../../state/controllers/recallController';
import { setWordSuspended } from '../../state/controllers/suspensionController';
import { applyReviewRating, markUnknownFromReading, undoReviewRating } from '../../state/controllers/reviewController';
import { loadReviewPlan } from '../../state/controllers/reviewSessionController';
import { renderPassageCorpus, resolveReviewMaterial } from '../../state/controllers/reviewMaterial';
import { openPassage } from '../../state/controllers/sessionBootstrap';
import { persistImage } from '../../infra/persistence/imageStore';
import { downscaleBlobToThumbnail } from '../../infra/persistence/imageThumbnail';
import { useReadingProgressPersistence } from '../../state/hooks/useReadingProgressPersistence';
import { usePassageThumbnails } from '../../state/hooks/usePassageThumbnails';
import type { ThumbnailControllerDeps } from '../../state/controllers/thumbnailController';
import { resolveVocabularyLevel } from '../../domain/session/sessionPlanner';
import { mergeWordIds, resolveTargetWordSelection } from '../../domain/session/targetWordResolution';
import { avoidWordIdsForNextChapter, collectChapterTargetWordIds } from '../../domain/story/chapterVocabulary';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import { readabilityForCefr } from '../../domain/difficulty/levelPreset';
import { masteryProjector } from '../../domain/srs/masteryProjector';
import { fsrs } from '../../domain/srs/fsrsScheduler';
import type { ReviewSessionPlan } from '../../domain/session/reviewSessionPlan';
import { DAILY_NEW_WORD_LIMIT, DAILY_REVIEW_LIMIT } from '../../domain/srs/parameters';
import { showToast } from '../../state/stores/toastStore';
import { generationProgressStore, isGenerationActive } from '../../state/stores/generationProgressStore';
import { colors, fonts, radius } from '../theme/tokens';
import type {
  CharacterIllustrationRequest,
  IndexedPassage,
  MasteryStage,
  Rating,
  SetupConfig,
  StoryCharacter,
  StoryPlan,
  StoryRecord,
  WordData,
  WordSchedulingState,
} from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

const CANDIDATE_LIMIT = 12;

/** Review/new slot split passed to the suggestion service (A-1-3): newWordRatio → reviewSlots + newSlots. */
function suggestionSlots(setup: SetupConfig): { reviewSlots: number; newSlots: number } {
  const plan = lengthSpec.targetWordPlanFor(setup.wordTarget, setup.newWordRatio);
  return { reviewSlots: plan.reviewSlots, newSlots: plan.newSlots };
}

type CharacterIllustrationVariant = NonNullable<CharacterIllustrationRequest['variant']>;
type CharacterIllustrationFields = Pick<
  StoryCharacter,
  'illustrationUrl' | 'portraitIllustrationUrl' | 'fullBodyIllustrationUrl'
>;

function characterWithIllustrations(character: StoryCharacter, illustrations: CharacterIllustrationFields): StoryCharacter {
  return {
    ...character,
    illustrationUrl: illustrations.illustrationUrl,
    portraitIllustrationUrl: illustrations.portraitIllustrationUrl,
    fullBodyIllustrationUrl: illustrations.fullBodyIllustrationUrl,
  };
}

/**
 * E-3(d) / D7: move a freshly generated character illustration pair off the story record and into the
 * `images` table, returning the same fields as `lexia-image:` references. The overview `illustrationUrl`
 * is the portrait's bytes, so it reuses the portrait's ref instead of storing the image twice. Plain
 * (non data-URL) values pass through untouched.
 */
async function persistCharacterIllustrations(
  c: Container,
  illustrations: CharacterIllustrationFields,
): Promise<CharacterIllustrationFields> {
  const now = c.now();
  const portrait = await persistImage(c.repos.images, c.userId, illustrations.portraitIllustrationUrl, now);
  const fullBody = await persistImage(c.repos.images, c.userId, illustrations.fullBodyIllustrationUrl, now);
  const overview =
    illustrations.illustrationUrl && illustrations.illustrationUrl === illustrations.portraitIllustrationUrl
      ? portrait
      : await persistImage(c.repos.images, c.userId, illustrations.illustrationUrl, now);
  return { illustrationUrl: overview, portraitIllustrationUrl: portrait, fullBodyIllustrationUrl: fullBody };
}

function selectedIds(candidates: CandidateWord[]): string[] {
  return candidates.map((candidate) => candidate.wordId);
}

/**
 * The learner's manual additions = the emitted target words minus whatever is currently previewed as
 * an auto candidate. Only these are persisted (A-1-1/A-2-1): auto-selected words never survive a
 * reset or re-visit.
 */
function manualTargetWordIds(setup: SetupConfig, candidates: CandidateWord[]): string[] {
  const autoIds = new Set(selectedIds(candidates).map((word) => word.trim().toLowerCase()));
  return setup.targetWordIds.filter((word) => !autoIds.has(word.trim().toLowerCase()));
}

function suggestionNotice(shortfall: { reason: 'exhausted' | 'gateway_unavailable' } | undefined): string | null {
  if (!shortfall) return null;
  if (shortfall.reason === 'gateway_unavailable') {
    return '単語提案サービスに接続できませんでした。復習語だけを表示しています。手動で追加できます。';
  }
  return '提案できる単語が不足しています。手動で追加できます。';
}

/** Daily new-word cap notice (C-5b): shown when today's DAILY_NEW_WORD_LIMIT clamp reduced new words. */
function newWordCapNotice(clamp: { remaining: number } | undefined): string | null {
  if (!clamp) return null;
  if (clamp.remaining <= 0) {
    return `本日の新出単語の上限（${DAILY_NEW_WORD_LIMIT}語）に達したため、この文章は復習語を中心に生成します。`;
  }
  return `本日はあと${clamp.remaining}語まで新出単語を導入できます（上限${DAILY_NEW_WORD_LIMIT}語）。`;
}

/** Reader URL for a passage: story chapters are /s/:storyId/:chapterIndex, articles are /p/:id. */
function readerPathFor(passageId: string, storyRef?: { storyId: string; chapterIndex: number }): string {
  return storyRef ? `/s/${storyRef.storyId}/${storyRef.chapterIndex}` : `/p/${passageId}`;
}

/**
 * Resolve the final woven-in target list at generation time (A-1-1). The learner's manual words are
 * always kept; the remaining slots (up to the `targetWordPlanFor` total) are back-filled from the
 * suggestion service so a passage with no hand-picked words still weaves in review + new vocabulary.
 * This is the ONE place auto-selection happens — nothing is prefilled on setup open, and the result
 * is used only for generation, never persisted. Falls back to the manual words if suggestion fails.
 *
 * `avoidWordIds` (A-1-4) is an extra exclusion list layered onto the suggest call: a continuing story
 * chapter passes the words its earlier chapters already introduced so each chapter meets fresh
 * vocabulary. It never suppresses manual words (they still take priority) and review-due words are
 * kept OUT of it by the caller so they may reappear.
 */
async function resolveTargetWordIds(c: Container, setup: SetupConfig, avoidWordIds: string[] = []): Promise<string[]> {
  const plan = lengthSpec.targetWordPlanFor(setup.wordTarget, setup.newWordRatio);
  const manual = setup.targetWordIds;
  // Manual words already meet the plan → no auto-selection needed (and no needless suggest call).
  if (manual.length >= plan.total) return manual;
  try {
    const result = await c.suggestions.suggest(
      {
        userId: c.userId,
        level: resolveVocabularyLevel(setup),
        intent: setup.intent,
        now: c.now(),
        tzOffsetMinutes: -new Date().getTimezoneOffset(), // F-4: daily new-word cap resets at local midnight
        // Fold the manual words (never re-proposed as duplicates) and the caller's avoid list (A-1-4:
        // earlier chapters' words) into the exclusions.
        excludedWordIds: mergeWordIds(setup.excludedWordIds ?? [], manual, avoidWordIds),
        count: plan.total,
        plan: suggestionSlots(setup),
      },
      c.repos.scheduling,
    );
    const suggested = result.candidates.map((candidate) => candidate.wordId);
    return resolveTargetWordSelection(manual, suggested, plan.total);
  } catch {
    return manual;
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

export function generationErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'kind' in error) {
    const kind = String((error as { kind: unknown }).kind);
    if (kind === 'refusal') return '生成が拒否されました。条件を少し変えてもう一度試してください。';
    if (kind === 'max_tokens') return '文章が長すぎて生成が途中で止まりました。文章の長さを短くしてください。';
    if (kind === 'validation_exhausted') return '生成文の検証に失敗しました。対象単語やテーマを調整してください。';
    if (kind === 'not_configured')
      return '生成サーバの API キーが未設定です。server/.env に OPENAI_API_KEY（または ANTHROPIC_API_KEY）を設定してサーバを再起動してください。';
    if (kind === 'rate_limited') return '生成リクエストが混み合っています。少し待ってから再試行してください。';
    if (kind === 'timeout')
      return '生成に時間がかかりすぎたため中断しました。もう一度お試しいただくか、文章の長さを短くしてください。';
    if (kind === 'aborted') return '生成をキャンセルしました。';
    if (kind === 'unavailable' || kind === 'network') return '生成サービスに接続できませんでした。時間をおいて再試行してください。';
  }
  return '文章生成に失敗しました。条件を確認してもう一度試してください。';
}

/** Persistent warning shown on Setup when the health probe reports the API key is unset (F-1). */
export function configWarningFor(health: { configured: boolean; provider: 'openai' | 'anthropic' }): string | null {
  if (health.configured) return null;
  const keyName = health.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  return `生成サーバの API キーが未設定です。server/.env に ${keyName} を設定してサーバを再起動すると文章を生成できます。`;
}

function uniqueStudyWords(passage: IndexedPassage): StudyWord[] {
  const seen = new Set<string>();
  const words: StudyWord[] = [];
  for (const span of passage.source.targetSpans) {
    if (seen.has(span.wordId)) continue;
    seen.add(span.wordId);
    words.push({ wordId: span.wordId, surface: span.wordId.trim() || span.surface, reappearCount: span.reappearInfo?.count });
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
    // A-1-4: never carry the home setup's manual/excluded words into a continuing chapter — each
    // chapter re-selects its words from scratch (resolveTargetWordIds + the per-chapter avoid list),
    // so lastSetup.targetWordIds can't pin every chapter to the same vocabulary.
    targetWordIds: [],
    excludedWordIds: [],
    storyOptions: {
      genre: plan.genre,
      ...(plan.homage?.title ? { homageTitle: plan.homage.title } : {}),
    },
  };
}

function isStoryContentType(contentType: SetupConfig['contentType']): contentType is 'short_story' | 'long_story' {
  return contentType === 'short_story' || contentType === 'long_story';
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
  const location = useLocation();
  const lastSetup = useStore(c.settings, (s) => s.lastSetup);
  const voiceId = useStore(c.settings, (s) => s.voiceId);
  // D-5: the due-word detail overlay lives at Home; opening a ledger row sets this, and a weave from
  // that overlay must dismiss it (see the effect below). Declared up here so the weave effect can
  // close it as it folds the carried word in.
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  // A-3-2: words carried in from the wordbook / word-detail / review「この単語で文章を生成」arrive in
  // location.state.addWordIds; merge them into the manual target list seeded on the Setup form.
  //
  // This has to work on BOTH a fresh Home mount (cross-route weave, e.g. /wordbook → '/') AND a
  // same-route '/'→'/' navigation (the Home due-word overlay's「次の文章に織り込む」, WordDetailRoute
  // onWeave). React Router keeps HomeRoute mounted across '/'→'/', so a one-shot capture would silently
  // drop the same-route weave. Instead we re-read location.state on every navigation (keyed on
  // location.key), and bump `composeNonce` to force the Setup form (whose manual chips are frozen at
  // mount) to re-seed from the recomputed `initialSetup`.
  const readCarriedWordIds = (loc: typeof location): string[] => {
    const carried = (loc.state as { addWordIds?: unknown } | null)?.addWordIds;
    return Array.isArray(carried)
      ? carried.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      : [];
  };
  const [carriedWordIds, setCarriedWordIds] = useState<string[]>(() => readCarriedWordIds(location));
  // location.key of the navigation already folded into carriedWordIds. Seeded with the mount-time key
  // so the initial carry (read synchronously above) is not re-processed; a later same-route navigate
  // arrives with a new key and is folded in exactly once.
  const processedWeaveKey = useRef<string>(location.key);
  // Remount key for the Setup form — bumped on each new weave so SetupScreen re-seeds its manual chips.
  const [composeNonce, setComposeNonce] = useState(0);
  useEffect(() => {
    // Strip carried ids out of history state so a reload / back-nav doesn't re-inject them (criterion 3).
    const hist = window.history.state as { usr?: { addWordIds?: unknown } | null } | null;
    if (hist?.usr && typeof hist.usr === 'object' && 'addWordIds' in hist.usr) {
      window.history.replaceState({ ...hist, usr: null }, '');
    }
    if (processedWeaveKey.current === location.key) return; // mount-time carry already seeded
    processedWeaveKey.current = location.key;
    const ids = readCarriedWordIds(location);
    if (ids.length === 0) return;
    setCarriedWordIds(ids);
    setComposeNonce((n) => n + 1);
    setSelectedWordId(null); // dismiss the Home due-word overlay so the weave visibly resolves
  }, [location.key]);
  const initialSetup = useMemo(
    () =>
      carriedWordIds.length > 0
        ? { ...lastSetup, targetWordIds: mergeWordIds(lastSetup.targetWordIds, carriedWordIds) }
        : lastSetup,
    [lastSetup, carriedWordIds],
  );
  // D-7: generation state lives in the app-wide generationProgressStore (not local useState) so it
  // survives navigating away from Home — the pipeline keeps running in this closure while the
  // TopNav indicator + completion toast are driven from AppShell. `generating`/`generationError` are
  // derived views used by the setup form + story gate; `gp()` reads the live store inside handlers.
  const genPhase = useStore(generationProgressStore, (s) => s.phase);
  const genStartedAt = useStore(generationProgressStore, (s) => s.startedAt);
  const genErrorMsg = useStore(generationProgressStore, (s) => s.error);
  const generating = isGenerationActive(genPhase);
  const generationError = genPhase === 'error' ? genErrorMsg : null;
  const gp = () => generationProgressStore.getState();
  // Startup config probe (F-1): warn up-front on Setup when the generation API key is unset, so the
  // learner fixes .env before hitting a failed generation. Non-blocking; skipped when unsupported.
  const [configWarning, setConfigWarning] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const probe = c.content.checkHealth?.();
    if (!probe) return;
    void probe
      .then((health) => {
        if (!cancelled) setConfigWarning(configWarningFor(health));
      })
      .catch(() => {
        // A failing probe is inconclusive (e.g. offline); don't assert a config problem.
      });
    return () => {
      cancelled = true;
    };
  }, [c]);

  // Target-word preview (A-1-1): the "今回織り込む単語" section starts EMPTY — nothing is prefilled on
  // setup open, so opening Home never calls the suggestion API. Candidates only appear when the
  // learner explicitly taps 「自動選択をプレビュー」 (refreshCandidates); the real auto-selection happens
  // at generation time in resolveTargetWordIds. Candidates shown here are never persisted.
  const [candidates, setCandidates] = useState<CandidateWord[]>([]);
  const [suggestionShortfall, setSuggestionShortfall] = useState<string | null>(null);
  const [newWordCapNoticeText, setNewWordCapNoticeText] = useState<string | null>(null);
  const [refreshingCandidates, setRefreshingCandidates] = useState(false);
  const [candidateRefreshError, setCandidateRefreshError] = useState<string | null>(null);

  const loadCandidates = useCallback(
    async (
      setup: SetupConfig,
      avoidWordIds: string[] = [],
    ): Promise<{ candidates: CandidateWord[]; notice: string | null; capNotice: string | null }> => {
      const excludedWordIds = mergeWordIds(setup.excludedWordIds ?? [], avoidWordIds);
      const result = await c.suggestions.suggest(
        {
          userId: c.userId,
          level: resolveVocabularyLevel(setup),
          intent: setup.intent,
          now: c.now(),
          tzOffsetMinutes: -new Date().getTimezoneOffset(), // F-4: daily new-word cap resets at local midnight
          excludedWordIds,
          count: CANDIDATE_LIMIT,
          plan: suggestionSlots(setup),
        },
        c.repos.scheduling,
      );
      return {
        candidates: result.candidates,
        notice: suggestionNotice(result.shortfall),
        capNotice: newWordCapNotice(result.newWordClamp),
      };
    },
    [c],
  );

  const commitLoadedCandidates = useCallback(
    (loaded: { candidates: CandidateWord[]; notice: string | null; capNotice: string | null }): void => {
      setCandidates(loaded.candidates);
      setSuggestionShortfall(loaded.notice);
      setNewWordCapNoticeText(loaded.capNotice);
    },
    [],
  );

  const refreshCandidates = async (
    setup: SetupConfig,
    avoidWordIds: string[] = selectedIds(candidates),
  ): Promise<CandidateWord[]> => {
    setRefreshingCandidates(true);
    setCandidateRefreshError(null);
    try {
      const loaded = await loadCandidates(setup, avoidWordIds);
      commitLoadedCandidates(loaded);
      return loaded.candidates;
    } catch {
      setCandidateRefreshError('単語候補を更新できませんでした。時間をおいて再試行してください。');
      return candidates;
    } finally {
      setRefreshingCandidates(false);
    }
  };

  const resetTargetWords = (): void => {
    // Reset = discard the two manual fields only (A-2-1). Read the currently-persisted setup and
    // patch just targetWordIds/excludedWordIds to empty — level, sliders and every other form value
    // are left untouched. Clear the on-screen preview too so the section returns to a plain default.
    setCandidateRefreshError(null);
    setCandidates([]);
    setSuggestionShortfall(null);
    setNewWordCapNoticeText(null);
    const current = c.settings.getState().lastSetup;
    c.settings.getState().setLastSetup({ ...current, targetWordIds: [], excludedWordIds: [] });
  };

  // Story confirmation gate (Requirement 6.3): when a story is generated, hold the plan for the
  // learner to confirm before any chapter body is produced. Only active when storyMode is on.
  const { storyMode, characterIllustrations, passageIllustrations } = resolveFeatureFlags();
  const [pendingPlan, setPendingPlan] = useState<StoryPlan | null>(null);
  const [pendingSetup, setPendingSetup] = useState<SetupConfig | null>(null);
  // True while character illustration pairs stream in on the confirmation gate (6.8); enrichment only.
  const [illustrating, setIllustrating] = useState(false);
  const [regeneratingPendingCharacterIndex, setRegeneratingPendingCharacterIndex] = useState<number | null>(null);
  const [pendingCharacterError, setPendingCharacterError] = useState<string | null>(null);
  const activeIllustrationRequest = useRef(0);
  // E-3(d): character images that finish AFTER the learner confirms the plan are persisted to the
  // stored story instead of being discarded. Writes are serialized on this chain because pairs land
  // concurrently and each does a read-modify-write on the same story record.
  const illustrationPersistChain = useRef<Promise<void>>(Promise.resolve());

  /**
   * Persist a completed character illustration pair onto an ALREADY-confirmed story record (the plan
   * was confirmed while this pair was still generating). No-ops while the plan is still on the gate
   * (no record yet) or when the character was already illustrated (a gate-time regenerate is kept).
   * Routes the bytes through the images table (D7) so the story record stays lean.
   */
  const persistConfirmedCharacterIllustration = (
    storyId: string,
    index: number,
    illustrations: CharacterIllustrationFields,
  ): void => {
    illustrationPersistChain.current = illustrationPersistChain.current
      .catch(() => undefined)
      .then(async () => {
        const record = await c.repos.stories.get(storyId);
        if (!record || record.userId !== c.userId) return; // not confirmed/persisted → keep in state only
        const existing = record.plan.characters[index];
        if (!existing || existing.fullBodyIllustrationUrl) return; // already illustrated — don't overwrite
        const stored = await persistCharacterIllustrations(c, illustrations);
        const characters = record.plan.characters.map((ch, i) =>
          i === index ? characterWithIllustrations(ch, stored) : ch,
        );
        await c.repos.stories.put({ ...record, plan: { ...record.plan, characters } });
      });
  };

  /**
   * Run the standard article generate → validate → persist → render pipeline, driving the
   * generation-progress store through each phase. `signal` is the store's AbortController signal
   * (cancel / timeout). On completion the store is settled (`finish`/`fail`); navigation is handled
   * centrally by AppShell's completion bridge (navigate on Home, toast elsewhere — D-7).
   */
  const runArticlePipeline = async (setup: SetupConfig, signal: AbortSignal): Promise<void> => {
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
        illustratePassage: passageIllustrations ? c.content.illustratePassage?.bind(c.content) : undefined,
        // 段階的生成 (settings.generationMode, default staged): open the reader on body-ready and
        // stream the annotation in afterwards; 'batch' restores the wait-for-everything gate.
        stagedGeneration: (c.settings.getState().generationMode ?? 'staged') === 'staged',
        annotatePassage: c.content.annotatePassage?.bind(c.content),
        signal,
        onPhase: (phase) => gp().setPhase(phase),
      },
      effectiveSetup,
      c.userId,
    );
    if (outcome.ok && outcome.passageId) gp().finish(outcome.passageId, `/p/${outcome.passageId}`);
    else if (!outcome.ok) gp().fail(generationErrorMessage(outcome.error));
  };

  const onGenerate = async (setup: SetupConfig): Promise<void> => {
    if (isGenerationActive(gp().phase)) return;
    const signal = gp().start(c.now()).signal; // phase='words', mints the AbortController
    try {
      // Persist ONLY the manual words (A-1-1/A-2-1): the auto-selected words are resolved fresh at
      // generation time (resolveTargetWordIds) and are never written back to lastSetup, or they would
      // revive as manual chips on the next visit. Level/sliders/etc. persist as chosen.
      c.settings.getState().setLastSetup({ ...setup, targetWordIds: manualTargetWordIds(setup, candidates) });
      // Story path: generate the plan and STOP at the confirmation gate (no body yet, 6.3).
      if (storyMode && isStoryContentType(setup.contentType)) {
        const planned = await c.storyPlanner.planStory({
          contentType: setup.contentType,
          genre: setup.storyOptions?.genre ?? 'fantasy',
          homageTitle: setup.storyOptions?.homageTitle,
          intent: setup.intent,
          level: resolveVocabularyLevel(setup),
        });
        if (signal.aborted) return; // cancelled while the plan was in flight (planStore isn't abortable)
        if (!planned.ok) {
          gp().fail(generationErrorMessage(planned.error));
          return;
        }
        // The confirmation gate takes over the UI now — settle the progress store back to idle so its
        // panel/indicator clear (this is not a passage "done"; the body is generated on confirm).
        gp().reset();
        // Show the plan immediately (gate is up), then stream in generated full-body + portrait pairs
        // (6.8). Full-body is generated first; overview pages use the separately generated portrait.
        // Illustration is enrichment: it never blocks confirmation, so failures are swallowed.
        setPendingSetup(setup);
        setPendingPlan(planned.value);
        setPendingCharacterError(null);
        setRegeneratingPendingCharacterIndex(null);
        activeIllustrationRequest.current += 1;
        setIllustrating(false);
        if (characterIllustrations) {
          const illustrationRequest = activeIllustrationRequest.current;
          setIllustrating(true);
          void c.storyPlanner
            .illustrateCharacters(planned.value, (index, illustrations) => {
              // Gate still up (this request wasn't superseded): reveal the pair in the on-screen plan.
              if (activeIllustrationRequest.current === illustrationRequest) {
                setPendingPlan((prev) => {
                  if (!prev || prev.storyId !== planned.value.storyId) return prev;
                  const characters = prev.characters.map((ch, i) =>
                    i === index ? characterWithIllustrations(ch, illustrations) : ch,
                  );
                  return { ...prev, characters };
                });
              }
              // E-3(d): if the plan was confirmed while this pair was still generating, the on-screen
              // update above is a no-op — persist the finished image to the stored story so the
              // character page's auto-regeneration never re-pays for an image already generated.
              persistConfirmedCharacterIllustration(planned.value.storyId, index, illustrations);
            })
            .finally(() => {
              if (activeIllustrationRequest.current === illustrationRequest) {
                setIllustrating(false);
              }
            });
        }
        return;
      }
      await runArticlePipeline(setup, signal);
    } catch (error) {
      // A deliberate cancel already reset the store to idle; don't surface it as an error.
      if (signal.aborted) return;
      gp().fail(generationErrorMessage(error));
    }
  };

  const regeneratePendingCharacter = async (
    characterIndex: number,
    planOverride?: StoryPlan,
    variant: CharacterIllustrationVariant = 'full_body',
  ): Promise<void> => {
    const plan = planOverride ?? pendingPlan;
    if (!plan || illustrating || regeneratingPendingCharacterIndex !== null) return;
    setPendingPlan(plan);
    setRegeneratingPendingCharacterIndex(characterIndex);
    setPendingCharacterError(null);
    try {
      const illustrations =
        variant === 'full_body'
          ? await c.storyPlanner.illustrateCharacterPair(plan, characterIndex)
          : await c.storyPlanner.illustrateCharacter(plan, characterIndex, variant).then((portraitIllustrationUrl) =>
              portraitIllustrationUrl
                ? {
                    illustrationUrl: portraitIllustrationUrl,
                    portraitIllustrationUrl,
                    fullBodyIllustrationUrl: plan.characters[characterIndex]?.fullBodyIllustrationUrl,
                  }
                : null,
            );
      if (!illustrations) {
        setPendingCharacterError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
        return;
      }
      setPendingPlan((prev) => {
        if (!prev || prev.storyId !== plan.storyId) return prev;
        const characters = prev.characters.map((ch, i) =>
          i === characterIndex ? characterWithIllustrations(ch, illustrations) : ch,
        );
        return { ...prev, characters };
      });
    } catch {
      setPendingCharacterError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingPendingCharacterIndex(null);
    }
  };

  // Confirmation gate passed: persist the plan, then generate + persist the first chapter and read it.
  const onConfirmPlan = async (plan: StoryPlan): Promise<void> => {
    if (isGenerationActive(gp().phase)) return;
    const signal = gp().start(c.now()).signal;
    try {
      if (!pendingSetup) {
        gp().fail('執筆に必要な設定が見つかりません。やり直してください。');
        return;
      }
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
          illustratePassage: passageIllustrations ? c.content.illustratePassage?.bind(c.content) : undefined,
          // 段階的生成 (settings.generationMode, default staged): open the reader on body-ready and
          // stream the annotation in afterwards; 'batch' restores the wait-for-everything gate.
          stagedGeneration: (c.settings.getState().generationMode ?? 'staged') === 'staged',
          annotatePassage: c.content.annotatePassage?.bind(c.content),
          signal,
          onPhase: (phase) => gp().setPhase(phase),
        },
        effectiveSetup,
        c.userId,
        {
          passageId: `${plan.storyId}:${chapterIndex}`,
          storyContext: { storyId: plan.storyId, chapterIndex, plan },
        },
      );
      if (!outcome.ok) {
        gp().fail(generationErrorMessage(outcome.error));
        return;
      }
      // The learner is watching the gate — navigate straight into the chapter (no cross-screen toast
      // needed) and settle the store back to idle so the bridge doesn't also navigate.
      gp().reset();
      // E-3(d): do NOT bump activeIllustrationRequest here. Any character images still generating must
      // keep flowing — now into the stored story (persistConfirmedCharacterIllustration) instead of
      // the (dismissed) gate — so confirming early never discards a paid-for illustration. The counter
      // is only bumped to discard a plan on cancel below.
      setPendingPlan(null);
      setPendingSetup(null);
      navigate(`/s/${plan.storyId}/${chapterIndex}`);
    } catch (error) {
      if (signal.aborted) return;
      gp().fail(generationErrorMessage(error));
    }
  };

  const snapshot = useLiveQuery(
    () =>
      loadDashboardSnapshot(
        { loadStates: c.loadStates, progress: c.repos.progress, reviewLog: c.repos.reviewLog, passages: c.repos.passages },
        c.userId,
        c.now(),
        -new Date().getTimezoneOffset(), // F-4: local-day boundary (JST → +540)
      ),
    [c],
  );

  // D-5: tapping a「復習が必要な単語」row opens that word's detail card as an overlay (ModalOverlay,
  // D-8) without leaving Home. Glosses are joined from wordCache for the words actually shown (the
  // first DUE_LIST_LIMIT); the projector is untouched. `/w/:wordId` provides the addressable page.
  // (`selectedWordId` state is declared at the top of the component so the weave effect can close it.)
  const dueGlossIds = (snapshot?.dueList ?? []).slice(0, DUE_LIST_LIMIT).map((d) => d.wordId);
  const dueGlossKey = dueGlossIds.join(',');
  const glosses = useLiveQuery(async () => {
    if (dueGlossIds.length === 0) return {} as Record<string, string>;
    const rows = await Promise.all(dueGlossIds.map((id) => c.repos.wordCache.get(c.userId, id)));
    const map: Record<string, string> = {};
    dueGlossIds.forEach((id, i) => {
      const gloss = rows[i]?.core.meaningsJa[0];
      if (gloss) map[id] = gloss;
    });
    return map;
    // dueGlossKey (the joined shown-word ids) captures the set this closure reads; re-run on change.
  }, [c, dueGlossKey]);

  // F-2: open the exact passage the CONTINUE card was showing (previously the arg was discarded and
  // resume always reopened the newest in-progress passage — "押したカードと違う文章が開く" bug). The
  // reader route's openPassage seeks to the saved sentence and stamps lastOpenedAt.
  const openContinue = async (passageId: string): Promise<void> => {
    const record = await c.repos.passages.get(passageId);
    navigate(readerPathFor(passageId, record?.passage.meta.storyRef));
  };

  if (pendingPlan) {
    return (
      <StoryPlanReview
        plan={pendingPlan}
        illustrating={illustrating}
        confirming={generating}
        confirmError={generationError}
        onRegenerateCharacter={
          characterIllustrations ? (index, plan) => void regeneratePendingCharacter(index, plan, 'full_body') : undefined
        }
        onRegenerateCharacterFullBody={
          characterIllustrations
            ? (index, plan) => void regeneratePendingCharacter(index, plan, 'full_body')
            : undefined
        }
        regeneratingCharacterIndex={regeneratingPendingCharacterIndex}
        regeneratingFullBodyCharacterIndex={regeneratingPendingCharacterIndex}
        characterIllustrationError={pendingCharacterError}
        onConfirm={(p) => void onConfirmPlan(p)}
        onCancel={() => {
          activeIllustrationRequest.current += 1;
          gp().reset(); // clear a lingering confirm error/indicator when the plan is discarded
          setPendingPlan(null);
          setPendingSetup(null);
          setIllustrating(false);
          setPendingCharacterError(null);
          setRegeneratingPendingCharacterIndex(null);
        }}
      />
    );
  }

  return (
    <>
      {/* `key={composeNonce}` remounts the Home compose tree when a weave folds a new carried word in,
          re-seeding SetupScreen's frozen manual chips from the recomputed initialSetup — this is what
          the cross-route weave path gets for free via a route remount (A-3-2, same-route '/'→'/' fix). */}
      <HomeScreen
        key={composeNonce}
        setup={{
          candidates,
          suggestionShortfall,
          newWordCapNotice: newWordCapNoticeText,
          refreshingCandidates,
          candidateRefreshError,
          initial: initialSetup,
          generating,
          generationError,
          generationProgress: {
            phase: genPhase,
            startedAt: genStartedAt,
            error: genErrorMsg,
            onCancel: () => gp().cancel(),
          },
          configWarning,
          onRefreshCandidates: (s) => void refreshCandidates(s),
          onResetTargetWords: () => resetTargetWords(),
          onGenerate: (s) => void onGenerate(s),
        }}
        snapshot={snapshot ?? undefined}
        now={c.now()}
        glosses={glosses ?? undefined}
        onContinue={(passageId) => void openContinue(passageId)}
        onStartReview={() => navigate('/review')}
        onSelectWord={(wordId) => setSelectedWordId(wordId)}
        onShowAllDue={() => navigate('/wordbook?filter=due')}
      />
      {/* D-5: the due-word detail overlay. ModalOverlay (D-8) supplies the backdrop, focus trap,
          scroll-lock and Esc/backdrop close; its panel is stripped to a transparent wrapper so the
          WordDetailCard renders its own card look (same body the /w/:wordId page reuses). */}
      {selectedWordId ? (
        <ModalOverlay
          label="単語詳細"
          onClose={() => setSelectedWordId(null)}
          panelStyle={wordOverlayPanelStyle}
        >
          <WordDetailRoute wordId={selectedWordId} onClose={() => setSelectedWordId(null)} />
        </ModalOverlay>
      ) : null}
    </>
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
  // E-3(e): passageId this reader opened FROM STORAGE (a revisit / URL-open), as opposed to a fresh
  // in-session generation (which runs its own illustration enrichment). Gates the scene backfill to
  // revisits so it never double-generates alongside generation-time enrichment.
  const openedFromStoreRef = useRef<string | null>(null);
  const backfilledIllustrationsRef = useRef<Set<string>>(new Set());

  // F-2: persist the live reading position (debounced + flushed on tab hide/close) so the learner
  // can resume where they left off. useSentenceTracking (in ReadingScreen) advances the position.
  useReadingProgressPersistence(c.session, c.repos.progress, c.userId);

  useEffect(() => {
    if (!targetPassageId) return;
    // Stale-audio guard: audio loaded for a previous passage must not keep playing (or stay
    // resumable) over this one — back to 'idle' so ▶ re-synthesizes on demand. An
    // 'unavailable' left by another passage's failed synthesize (nothing loaded) resets the
    // same way: only the passage that failed stays degraded, not every passage after it.
    const player = c.player.getState();
    if (
      (player.loadedPassageId != null && player.loadedPassageId !== targetPassageId) ||
      (player.status === 'unavailable' && passage?.passageId !== targetPassageId)
    ) {
      player.unload();
    }
    if (passage?.passageId === targetPassageId) {
      setNotFound(false);
      return;
    }
    let cancelled = false;
    setNotFound(false); // clear any prior not-found while the new open is in flight (no error flash)
    // This open reads the passage from storage → mark it backfill-eligible (set BEFORE the async open
    // so the ref is already in place when the session-passage update re-runs the backfill effect).
    openedFromStoreRef.current = targetPassageId;
    void (async () => {
      const opened = await openPassage(
        { passages: c.repos.passages, progress: c.repos.progress, session: c.session },
        c.userId,
        targetPassageId,
        c.now(),
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
  const [regeneratingPassageIllustration, setRegeneratingPassageIllustration] = useState(false);
  const [passageIllustrationError, setPassageIllustrationError] = useState<string | null>(null);
  const [regeneratingAnnotation, setRegeneratingAnnotation] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [regeneratingStoryCharacterIndex, setRegeneratingStoryCharacterIndex] = useState<number | null>(null);
  const [storyCharacterError, setStoryCharacterError] = useState<string | null>(null);
  const { newReadingLayout, passageIllustrations, characterIllustrations } = resolveFeatureFlags();

  // C-5d: words the learner looked up / marked unknown during THIS passage's session. They are
  // excluded from the completion read-through credit so a looked-up word never also earns a Good.
  const signaledWordsRef = useRef<{ passageId: string | null; words: Set<string> }>({ passageId: null, words: new Set() });
  const noteReadingSignal = useCallback(
    (wordId: string): void => {
      const pid = c.session.getState().passage?.passageId ?? null;
      if (signaledWordsRef.current.passageId !== pid) {
        signaledWordsRef.current = { passageId: pid, words: new Set() };
      }
      signaledWordsRef.current.words.add(wordId);
    },
    [c],
  );

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

  // E-3(e): silently backfill a scene illustration for a revisited passage that was saved WITHOUT one
  // (its image API call failed at generation time). Once per session per passageId; a success replaces
  // the session passage so the scene appears in place while reading. Only revisits are eligible (see
  // openedFromStoreRef) so this never races the generation-time enrichment. The manual regenerate
  // button stays the explicit path.
  useEffect(() => {
    const illustrate = c.content.illustratePassage;
    if (!passageIllustrations || !illustrate) return;
    if (!passage || passage.passageId !== targetPassageId) return;
    if (passage.passageId !== openedFromStoreRef.current) return; // fresh generations enrich themselves
    if (passage.source.meta.sceneIllustrationUrl) return; // already illustrated
    const ref = passage.source.meta.storyRef;
    if (ref && storyDetails === undefined) return; // wait for the plan so the scene stays cast-consistent
    const pid = passage.passageId;
    if (backfilledIllustrationsRef.current.has(pid)) return;
    backfilledIllustrationsRef.current.add(pid);
    const storyContext =
      ref && storyDetails?.story
        ? { storyId: ref.storyId, chapterIndex: ref.chapterIndex, plan: storyDetails.story.plan }
        : undefined;
    void backfillPassageIllustration(
      {
        passages: c.repos.passages,
        images: c.repos.images,
        session: c.session,
        illustratePassage: illustrate.bind(c.content),
        userId: c.userId,
        now: c.now,
      },
      pid,
      storyContext,
    );
  }, [c, passageIllustrations, passage, targetPassageId, storyDetails]);

  // 段階的生成 rescue: a passage stored with annotationStatus 'pending' whose background annotation
  // never landed (the tab closed / reloaded mid-run) would sit annotation-less forever. On revisit,
  // run the same annotate-merge-persist path as the manual 再生成 button, once per session per passage.
  const backfilledAnnotationsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!c.content.annotatePassage) return;
    if (!passage || passage.passageId !== targetPassageId) return;
    if (passage.source.meta.annotationStatus !== 'pending') return;
    if (passage.passageId !== openedFromStoreRef.current) return; // fresh generations annotate themselves
    if (backfilledAnnotationsRef.current.has(passage.passageId)) return;
    backfilledAnnotationsRef.current.add(passage.passageId);
    void regenerateAnnotation();
  }, [c, passage, targetPassageId]);

  const playStudyWord = (wordId: string): void => {
    void (async () => {
      try {
        const url = await c.tts.wordClipUrl(wordId, voiceId || c.voiceId);
        c.player.getState().playWord(url);
      } catch {
        // Pronunciation is enrichment; keep the reading rail usable when TTS is unavailable.
      }
    })();
  };

  const markStudyTargetUnknown = async (targetId: string): Promise<void> => {
    noteReadingSignal(targetId); // an Again this session excludes the word from read-through credit
    // F-3: reading-time「知らなかった」— resets the interval like an Again but logs source='passage'.
    await markUnknownFromReading(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      targetId,
      c.now(),
    );
  };

  const handleOpenWordDetail = (wordId: string): void => {
    // C-5d: opening a word's detail is a lookup — record it (so completion skips it) and fire the
    // recall signal (Again-equivalent, suppressed to once per 24h by the cross-source cooldown).
    noteReadingSignal(wordId);
    void applyRecallSignal(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      { kind: 'lookup', wordId, at: c.now() },
    );
  };

  const studyWords = useLiveQuery<StudyWord[] | undefined>(async () => {
    if (!passage) return undefined;
    const words = uniqueStudyWords(passage);
    return Promise.all(
      words.map(async (word) => {
        const [state, data] = await Promise.all([
          c.repos.scheduling.get(c.userId, word.wordId),
          loadAndCacheWordData(c, word.wordId).catch(() => undefined),
        ]);
        return {
          ...word,
          surface: data?.headword ?? word.surface,
          stage: state ? masteryProjector.deriveMastery(state, { kind: 'none' }) : undefined,
          reappearCount: state?.reappearCount ?? word.reappearCount,
          meaningJa: data?.core.meaningsJa[0],
          collocation: data?.core.collocations[0]?.pattern,
          register: data?.register,
          connotation: data?.connotation,
          frequency: data?.frequency,
          memoryTipJa: data?.memoryTips?.[0]?.tipJa,
        };
      }),
    );
  }, [c, passage?.passageId]);

  const completeReading = async (): Promise<ReadingCompletionSummary | void> => {
    const active = c.session.getState().passage;
    if (!active) return;
    const now = c.now();
    const words = uniqueStudyWords(active);
    // C-5d: same-session lookup / Again words are already scheduled (a lapse); crediting them a
    // read-through Good here would overwrite that, so they get no read-through credit.
    const signaled = signaledWordsRef.current.passageId === active.passageId ? signaledWordsRef.current.words : new Set<string>();
    const creditable = words.filter((word) => !signaled.has(word.wordId));
    await Promise.all(
      creditable.map((word) =>
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
    return { total: words.length, needReview: words.length - creditable.length };
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
        // Back to 'idle' (not 'unavailable'): the bar stays visible on the revisited chapter and
        // ▶ synthesizes its audio on demand instead of hiding the player outright.
        c.player.getState().unload();
        // Sync the address bar to the already-generated chapter so a reload/share reopens the right
        // one (the reader is URL-addressable now). The session already holds this chapter, so the
        // ReadingRoute open-effect's guard short-circuits — no redundant re-open.
        navigate(`/s/${ref.storyId}/${nextIndex}`);
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
      // A-1-4: avoid re-introducing words earlier chapters already taught, but let review-due words
      // reappear. Building the avoid set from the currently-due scheduling states (one query) means a
      // word already woven in is dropped from「avoid」only when it is genuinely review-due now.
      const priorChapterWordIds = collectChapterTargetWordIds(continuation.chapters);
      const dueStates = await c.repos.scheduling.dueBefore(c.userId, c.now());
      const dueByWordId = new Map(dueStates.map((state) => [state.wordId.trim().toLowerCase(), state]));
      const avoidWordIds = avoidWordIdsForNextChapter(priorChapterWordIds, dueByWordId, c.now());
      const targetWordIds = await resolveTargetWordIds(c, setup, avoidWordIds);
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
          illustratePassage: passageIllustrations ? c.content.illustratePassage?.bind(c.content) : undefined,
          stagedGeneration: (c.settings.getState().generationMode ?? 'staged') === 'staged',
          annotatePassage: c.content.annotatePassage?.bind(c.content),
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

  const regeneratePassageIllustration = async (): Promise<void> => {
    if (!c.content.illustratePassage || regeneratingPassageIllustration) return;
    const active = c.session.getState().passage;
    if (!active) return;
    if (active.source.meta.storyRef && storyDetails === undefined) {
      setPassageIllustrationError('物語情報を読み込み中です。少し待って再試行してください。');
      return;
    }

    setRegeneratingPassageIllustration(true);
    setPassageIllustrationError(null);
    try {
      const record = await c.repos.passages.get(active.passageId);
      if (!record || record.userId !== c.userId) {
        setPassageIllustrationError('本文データを確認できませんでした。文章を開き直してください。');
        return;
      }
      const indexed = tokenizer.index(record.passageId, record.passage);
      const ref = indexed.source.meta.storyRef;
      const storyContext =
        ref && storyDetails?.story
          ? { storyId: ref.storyId, chapterIndex: ref.chapterIndex, plan: storyDetails.story.plan }
          : undefined;
      const illustrationUrl = await c.content.illustratePassage(buildPassageIllustrationRequest(indexed, storyContext));
      const enrichedSource = {
        ...record.passage,
        meta: {
          ...record.passage.meta,
          sceneIllustrationUrl: illustrationUrl,
        },
      };
      await c.repos.passages.put({ ...record, passage: enrichedSource });
      c.session.getState().replacePassage(tokenizer.index(record.passageId, enrichedSource));
    } catch {
      setPassageIllustrationError('本文イラストを再生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingPassageIllustration(false);
    }
  };

  const regenerateAnnotation = async (): Promise<void> => {
    if (!c.content.annotatePassage || regeneratingAnnotation) return;
    const active = c.session.getState().passage;
    if (!active) return;
    setRegeneratingAnnotation(true);
    setAnnotationError(null);
    try {
      const record = await c.repos.passages.get(active.passageId);
      if (!record || record.userId !== c.userId) {
        setAnnotationError('本文データを確認できませんでした。文章を開き直してください。');
        return;
      }
      const source = record.passage;
      // C-4: re-derive the hard-sentence list from the passage's self-reported syntaxSpans so the
      // regenerated annotation refreshes syntax notes too, matching the generation-time annotate call.
      const hardSentenceIndexes = source.syntaxSpans
        ? [...new Set(source.syntaxSpans.map((s) => s.sentenceIndex))].sort((a, b) => a - b)
        : undefined;
      const result = await c.content.annotatePassage({
        sentences: source.sentences,
        level: source.meta.level,
        readabilityLevel: readabilityForCefr(source.meta.level),
        hardSentenceIndexes,
        targetSpans: source.targetSpans,
        collocationSpans: source.collocationSpans,
        expressionSpans: source.expressionSpans,
      });
      const enrichedSource = {
        ...source,
        noticeCues: result.noticeCues,
        ...(result.sentenceNotes && result.sentenceNotes.length > 0 ? { syntaxNotes: result.sentenceNotes } : {}),
        meta: { ...source.meta, annotationStatus: result.status },
      };
      await c.repos.passages.put({ ...record, passage: enrichedSource });
      c.session.getState().replacePassage(tokenizer.index(record.passageId, enrichedSource));
      if (result.status !== 'complete') {
        setAnnotationError('注釈をまだ生成できませんでした。時間をおいて再試行してください。');
      }
    } catch {
      setAnnotationError('注釈を再生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingAnnotation(false);
    }
  };

  const regenerateStoredStoryCharacter = async (characterIndex: number): Promise<void> => {
    const story = storyDetails?.story;
    if (!story || regeneratingStoryCharacterIndex !== null) return;
    setRegeneratingStoryCharacterIndex(characterIndex);
    setStoryCharacterError(null);
    try {
      const illustrations = await c.storyPlanner.illustrateCharacterPair(story.plan, characterIndex);
      if (!illustrations) {
        setStoryCharacterError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
        return;
      }
      const characters = story.plan.characters.map((ch, i) =>
        i === characterIndex ? characterWithIllustrations(ch, illustrations) : ch,
      );
      await c.repos.stories.put({ ...story, plan: { ...story.plan, characters } });
    } catch {
      setStoryCharacterError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingStoryCharacterIndex(null);
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

  // Loading (D-7): while the target passage is still being opened — and it hasn't resolved to
  // not-found — show a skeleton. Rendering ReadingScreen with an unresolved passage would flash its
  // "読む文章がありません…" empty state for a frame on every /p/:id open (and on chapter switches).
  if (!passage || passage.passageId !== targetPassageId) {
    return <ScreenSkeleton />;
  }

  // The display-improvement cluster (Requirements 1–4) is shipped, so the reading-layout flag is
  // on by default; resolveFeatureFlags still allows an override to disable it.
  return (
    <ReadingScreen
      passage={passage ?? undefined}
      studyWords={passage ? (studyWords ?? uniqueStudyWords(passage)) : undefined}
      onPlayWord={playStudyWord}
      newLayout={newReadingLayout}
      onMarkUnknown={markStudyTargetUnknown}
      onOpenWordDetail={handleOpenWordDetail}
      onCompleteReading={() => completeReading()}
      storyPlan={storyDetails?.story.plan}
      onRegenerateIllustration={
        passageIllustrations && c.content.illustratePassage ? () => void regeneratePassageIllustration() : undefined
      }
      regeneratingIllustration={regeneratingPassageIllustration}
      illustrationError={passageIllustrationError}
      onRegenerateAnnotation={c.content.annotatePassage ? () => void regenerateAnnotation() : undefined}
      regeneratingAnnotation={regeneratingAnnotation}
      annotationError={annotationError}
      onRegenerateStoryCharacter={
        characterIllustrations && storyDetails?.story ? (index) => void regenerateStoredStoryCharacter(index) : undefined
      }
      regeneratingStoryCharacterIndex={regeneratingStoryCharacterIndex}
      storyCharacterError={storyCharacterError}
      onGenerateNextChapter={
        storyDetails?.story.plan.contentType === 'long_story' ? () => void generateNextStoryChapter() : undefined
      }
      generatingNextChapter={generatingNextChapter}
      nextChapterError={nextChapterError}
      renderWordDetail={(wordId, onClose) => <WordDetailRoute wordId={wordId} onClose={onClose} />}
    />
  );
}

// ── Review → confirm gate → frozen session (C-5c, Flow 2) ────────────────────

/** Build a ReviewItem from scheduling state + WordData + a resolved new-context sentence. */
function reviewItemFromState(
  state: WordSchedulingState,
  word: WordData | undefined,
  context: ReviewItem['context'],
): ReviewItem {
  return {
    state,
    headword: word?.headword ?? state.wordId,
    ipa: word?.ipa,
    context,
    answer: {
      meaningJa: word?.core.meaningsJa.join(' / ') || '意味データを取得できませんでした',
      detailJa: word?.core.synonymNuances[0],
      collocations: word?.core.collocations.map((col) => col.pattern),
      register: word?.register,
      synonyms: word?.more?.semanticNetwork?.filter((n) => n.relation === 'synonym').map((n) => n.word),
    },
  };
}

/** Parse the optional `/review?words=w1,w2` scope into a word-id list (undefined ⇒ all due). */
function parseReviewWordsParam(search: string): string[] | undefined {
  const raw = new URLSearchParams(search).get('words');
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export function ReviewRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const location = useLocation();
  const dailyLimit = useStore(c.settings, (s) => s.dailyReviewLimit ?? DAILY_REVIEW_LIMIT);
  const wordFilter = useMemo(() => parseReviewWordsParam(location.search), [location.search]);

  // Start gate: the plan is loaded ONCE (not a live subscription) so the confirmation counts stay
  // stable and the session that follows freezes its due set at 開始 — no useLiveQuery remounts as
  // ratings shrink the live set. Card display data (WordData + new-context sentence) still streams
  // in lazily against the frozen snapshot (E-3(f)), keyed by word id.
  const [plan, setPlan] = useState<ReviewSessionPlan | null>(null);
  const [snapshot, setSnapshot] = useState<WordSchedulingState[] | null>(null);
  const [resolved, setResolved] = useState<Record<string, { word?: WordData; context: ReviewItem['context'] }>>({});
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setSnapshot(null);
    setResolved({});
    void loadReviewPlan(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      c.now(),
      dailyLimit,
      wordFilter,
      -new Date().getTimezoneOffset(), // F-4: reset the daily review budget at local midnight (JST → +540)
    ).then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [c, dailyLimit, wordFilter]);

  // Serial write queue: ratings/undos apply in order (each applyReviewRating reads the prior write's
  // result) and one failure never blocks the next write.
  const enqueue = (task: () => Promise<unknown>): void => {
    writeChain.current = writeChain.current.catch(() => {}).then(task);
  };

  const persistRating = async (wordId: string, rating: Rating, now: number, attempt = 0): Promise<void> => {
    try {
      await applyReviewRating({ scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog }, c.userId, wordId, rating, now);
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        return persistRating(wordId, rating, now, attempt + 1);
      }
      showToast({ message: '評定の保存に失敗しました。通信状況を確認してください。', tone: 'error', durationMs: 0 });
      throw err;
    }
  };

  // "開始": freeze the due set, then stream each card's WordData + new-context sentence into the
  // frozen queue by word id (the session paints its first frame from the snapshot alone).
  const start = (): void => {
    if (!plan || plan.queue.length === 0) return;
    const snap = plan.queue;
    setSnapshot(snap);
    void (async () => {
      const passages = await c.repos.passages.all(c.userId).catch(() => []);
      const corpus = renderPassageCorpus(passages);
      const reviewSentence = c.content.reviewSentence ? c.content.reviewSentence.bind(c.content) : undefined;
      for (const state of snap) {
        void (async () => {
          let word: WordData | undefined;
          try {
            word = await loadAndCacheWordData(c, state.wordId);
          } catch {
            word = undefined;
          }
          const headword = word?.headword ?? state.wordId;
          const material = await resolveReviewMaterial({ corpus, reviewSentence }, word, headword, state.level ?? 'B1', state.reps);
          if (aliveRef.current) setResolved((prev) => ({ ...prev, [state.wordId]: { word, context: material.context } }));
        })();
      }
    })();
  };

  const onRate = (wordId: string, rating: Rating): void => {
    enqueue(() => persistRating(wordId, rating, c.now()));
  };
  const onUndo = (_wordId: string, prior: WordSchedulingState, ratingUndone: Rating): void => {
    enqueue(() => undoReviewRating({ scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog }, prior, ratingUndone, c.now()));
  };

  if (snapshot) {
    const queue: ReviewItem[] = snapshot.map((state) => {
      const entry = resolved[state.wordId];
      const headword = entry?.word?.headword ?? state.wordId;
      const context = entry?.context ?? { before: '', target: headword, after: '' };
      const item = reviewItemFromState(state, entry?.word, context);
      return entry ? item : { ...item, loading: true };
    });
    return (
      <ReviewSession
        key="review-session"
        queue={queue}
        now={c.now()}
        onRate={onRate}
        onUndo={onUndo}
        onHome={() => navigate('/')}
        onGenerateFromWords={(ids) => navigate('/', { state: { addWordIds: ids } })}
        onOpenWord={(wordId) => navigate(`/w/${encodeURIComponent(wordId)}`)}
      />
    );
  }

  if (!plan) return <ScreenSkeleton />;

  return (
    <ReviewStartGate
      plan={plan}
      dailyLimit={dailyLimit}
      hasFilter={!!wordFilter}
      onStart={start}
      onHome={() => navigate('/')}
      onGenerate={() => navigate('/')}
    />
  );
}

// ── Wordbook (live list, 11.x) ───────────────────────────────────────────────

export function WordbookRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  // D-5: honour `/wordbook?filter=due` (the「他 M 語を単語帳で見る」deep-link opens要復習 pre-applied).
  // D-3: honour `?sort=` and mirror the chosen sort back into the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = searchParams.get('filter') === 'due' ? 'due' : 'all';
  const sortParam = searchParams.get('sort');
  const initialSort: WordSort = sortParam === 'abc' || sortParam === 'stabilityAsc' ? sortParam : 'dueAsc';
  const onSortChange = (sort: WordSort): void => {
    const next = new URLSearchParams(searchParams);
    if (sort === 'dueAsc') next.delete('sort');
    else next.set('sort', sort);
    setSearchParams(next, { replace: true });
  };

  const words = useLiveQuery<WordbookEntry[]>(async () => {
    const [states, cache] = await Promise.all([c.loadStates(c.userId), c.repos.wordCache.all(c.userId)]);
    const byId = new Map(cache.map((w) => [w.wordId, w]));
    return states.map((s) => {
      const data = byId.get(s.wordId);
      const stage: MasteryStage = masteryProjector.deriveMastery(s, { kind: 'none' });
      return {
        wordId: s.wordId,
        headword: data?.headword ?? s.wordId,
        gloss: data?.core.meaningsJa[0],
        // D-3: up to 2 meanings on the row; dueAt/stability drive the dueAsc/stabilityAsc sorts.
        glosses: data?.core.meaningsJa.slice(0, 2),
        stage,
        due: s.dueAt <= c.now(),
        dueAt: s.dueAt,
        stability: s.stability,
        suspended: s.suspended ?? false,
      };
    });
  }, [c]);

  const suspendWord = async (wordId: string): Promise<void> => {
    await setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, wordId, true, c.now());
    showToast({
      message: `${wordId} を復習から外しました`,
      tone: 'success',
      action: {
        label: '取り消す',
        onAction: () => void setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, wordId, false, c.now()),
      },
    });
  };
  const restoreWord = async (wordId: string): Promise<void> => {
    await setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, wordId, false, c.now());
  };

  // 0-word flash fix (D-3): while the live query is unresolved (undefined), show a skeleton instead
  // of falling back to `[]`, which would flash "全 0 語" / "該当する単語がありません" for one frame.
  if (words === undefined) return <ScreenSkeleton />;

  return (
    <WordbookScreen
      words={words}
      initialFilter={initialFilter}
      initialSort={initialSort}
      onSortChange={onSortChange}
      now={c.now()}
      renderWordDetail={(wordId, onClose) => <WordDetailRoute wordId={wordId} onClose={onClose} />}
      onSuspend={(wordId) => void suspendWord(wordId)}
      onRestore={(wordId) => void restoreWord(wordId)}
      // A-3-2: carry the checked words to Home as manual additions (consumed by HomeRoute's
      // location.state reader), then generate a passage that weaves them in.
      onWeaveWords={(ids) => navigate('/', { state: { addWordIds: ids } })}
      // C-5c: scope a review session to exactly the checked words via /review?words=….
      onReviewWords={(ids) => navigate(`/review?words=${ids.map((id) => encodeURIComponent(id)).join(',')}`)}
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
  // D-4: reading progress by passageId (both statuses merged) so each row can show 読了/続きから/未読.
  const progress = useLiveQuery(async () => {
    const [inProgress, completed] = await Promise.all([
      c.repos.progress.byStatus(c.userId, 'in_progress'),
      c.repos.progress.byStatus(c.userId, 'completed'),
    ]);
    return Object.fromEntries([...inProgress, ...completed].map((p) => [p.passageId, p] as const));
  }, [c]);

  // D-4 第2段: lazily downscale each illustration into a 192×128 thumbnail on first list render, then
  // reuse it (`meta.sceneThumbnailUrl`) so the list decodes tiny images. The useLiveQuery above
  // re-renders on the smaller image once each thumbnail is stored.
  const thumbnailDeps = useMemo<ThumbnailControllerDeps>(
    () => ({
      passages: c.repos.passages,
      images: c.repos.images,
      userId: c.userId,
      now: c.now,
      downscale: (blob) => downscaleBlobToThumbnail(blob),
    }),
    [c],
  );
  usePassageThumbnails(thumbnailDeps, passages);

  if (!passages) return <ScreenSkeleton />;

  return (
    <LibraryScreen
      passages={passages}
      storyTitles={storyTitles ?? {}}
      progress={progress ?? {}}
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
  const [regeneratingCharacterIndex, setRegeneratingCharacterIndex] = useState<number | null>(null);
  const [characterIllustrationError, setCharacterIllustrationError] = useState<string | null>(null);
  const { characterIllustrations } = resolveFeatureFlags();

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
    return { story, plan: story.plan, rows };
  }, [c, storyId]);

  const regenerateCharacter = async (characterIndex: number): Promise<void> => {
    if (!data || !('story' in data) || regeneratingCharacterIndex !== null) return;
    const story = data.story;
    setRegeneratingCharacterIndex(characterIndex);
    setCharacterIllustrationError(null);
    try {
      const illustrations = await c.storyPlanner.illustrateCharacterPair(story.plan, characterIndex);
      if (!illustrations) {
        setCharacterIllustrationError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
        return;
      }
      const characters = story.plan.characters.map((ch, i) =>
        i === characterIndex ? characterWithIllustrations(ch, illustrations) : ch,
      );
      await c.repos.stories.put({ ...story, plan: { ...story.plan, characters } });
    } catch {
      setCharacterIllustrationError('キャラクターイラストを再生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingCharacterIndex(null);
    }
  };

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
      onOpenCharacter={(characterIndex) => navigate(`/s/${storyId}/characters/${characterIndex}`)}
      onRegenerateCharacter={characterIllustrations ? (index) => void regenerateCharacter(index) : undefined}
      regeneratingCharacterIndex={regeneratingCharacterIndex}
      characterIllustrationError={characterIllustrationError}
    />
  );
}

export function StoryCharacterDetailRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const params = useParams();
  const storyId = params.storyId ?? '';
  const characterIndex = Number(params.characterIndex);
  const [regeneratingFullBody, setRegeneratingFullBody] = useState(false);
  const [illustrationError, setIllustrationError] = useState<string | null>(null);
  const [autoRequestedKey, setAutoRequestedKey] = useState<string | null>(null);
  const { characterIllustrations } = resolveFeatureFlags();

  const data = useLiveQuery(async () => {
    if (!Number.isInteger(characterIndex) || characterIndex < 0) return null;
    const story = await c.repos.stories.get(storyId);
    if (!story || story.userId !== c.userId) return null;
    if (!story.plan.characters[characterIndex]) return null;
    return { story, plan: story.plan };
  }, [c, storyId, characterIndex]);

  const regenerateFullBody = useCallback(async (): Promise<void> => {
    if (!data || regeneratingFullBody) return;
    const story = data.story;
    setRegeneratingFullBody(true);
    setIllustrationError(null);
    try {
      const illustrations = await c.storyPlanner.illustrateCharacterPair(story.plan, characterIndex);
      if (!illustrations) {
        setIllustrationError('全身イラストを生成できませんでした。時間をおいて再試行してください。');
        return;
      }
      const characters = story.plan.characters.map((ch, i) =>
        i === characterIndex ? characterWithIllustrations(ch, illustrations) : ch,
      );
      await c.repos.stories.put({ ...story, plan: { ...story.plan, characters } });
    } catch {
      setIllustrationError('全身イラストを生成できませんでした。時間をおいて再試行してください。');
    } finally {
      setRegeneratingFullBody(false);
    }
  }, [c, characterIndex, data, regeneratingFullBody]);

  useEffect(() => {
    if (!characterIllustrations || !data || regeneratingFullBody) return;
    const character = data.plan.characters[characterIndex];
    const portraitUrl = character?.portraitIllustrationUrl ?? character?.illustrationUrl;
    const hasDedicatedPortrait = !!portraitUrl && portraitUrl !== character?.fullBodyIllustrationUrl;
    if (!character || (character.fullBodyIllustrationUrl && hasDedicatedPortrait)) return;
    const key = `${data.plan.storyId}:${characterIndex}:full_body`;
    if (autoRequestedKey === key) return;
    setAutoRequestedKey(key);
    void regenerateFullBody();
  }, [autoRequestedKey, characterIllustrations, characterIndex, data, regenerateFullBody, regeneratingFullBody]);

  if (data === undefined) return <ScreenSkeleton />;
  if (data === null) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>人物が見つかりません</div>
        <button type="button" onClick={() => navigate(`/s/${storyId}`)} style={notFoundButtonStyle}>
          物語へ戻る
        </button>
      </div>
    );
  }

  return (
    <StoryCharacterDetailScreen
      plan={data.plan}
      characterIndex={characterIndex}
      onBack={() => navigate(`/s/${storyId}`)}
      onRegenerateFullBody={characterIllustrations ? () => void regenerateFullBody() : undefined}
      regeneratingFullBody={regeneratingFullBody}
      illustrationError={illustrationError}
    />
  );
}

// ── Shared word-detail overlay (8.4) ─────────────────────────────────────────

function WordDetailRoute({ wordId, onClose }: { wordId: string; onClose: () => void }): ReactNode {
  const c = useContainer();
  const navigate = useNavigate();
  const loadWord = useCallback((id: string) => loadAndCacheWordData(c, id), [c]);
  const { data: word, isError, refetch } = useWordData(loadWord, wordId);
  const voiceId = useStore(c.settings, (s) => s.voiceId);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const schedulingState = useLiveQuery(async () => {
    const s = await c.repos.scheduling.get(c.userId, wordId);
    return s ?? null;
  }, [c, wordId]);
  const stage = schedulingState ? masteryProjector.deriveMastery(schedulingState, { kind: 'none' }) : undefined;
  const suspended = !!schedulingState?.suspended;
  // D-3: FSRS transparency — surface the next-review date + ideal-cadence reviews-to-定着 on the card.
  // Only words with a scheduling record get the block (未学習語では出さない).
  const scheduling = schedulingState
    ? { dueAt: schedulingState.dueAt, repsToConsolidate: fsrs.repsToConsolidate(schedulingState) }
    : undefined;

  useEffect(() => {
    let cancelled = false;
    setClipUrl(null);
    void (async () => {
      try {
        const url = await c.tts.wordClipUrl(wordId, voiceId || c.voiceId);
        if (!cancelled) setClipUrl(url);
      } catch {
        if (!cancelled) setClipUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [c, wordId, voiceId]);

  const markUnknown = async (targetWordId: string): Promise<void> => {
    // F-3: marking a word unknown from its detail card is a reading-time miss — same Again reschedule,
    // recorded as source='passage' so it doesn't count as an explicit review.
    await markUnknownFromReading(
      { scheduling: c.repos.scheduling, reviewLog: c.repos.reviewLog },
      c.userId,
      targetWordId,
      c.now(),
    );
  };

  const markKnown = async (targetWordId: string): Promise<void> => {
    await setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, targetWordId, true, c.now());
    showToast({
      message: `${word?.headword ?? targetWordId} を復習から外しました`,
      tone: 'success',
      action: {
        label: '取り消す',
        onAction: () => void setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, targetWordId, false, c.now()),
      },
    });
  };

  const restoreWord = async (targetWordId: string): Promise<void> => {
    await setWordSuspended({ scheduling: c.repos.scheduling }, c.userId, targetWordId, false, c.now());
  };

  if (isError && !word) {
    return (
      <div style={detailLoadingStyle}>
        <div style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.ink }}>{wordId}</div>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
          単語情報の取得に失敗しました
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
          <button type="button" onClick={() => void refetch()} style={detailRetryButtonStyle}>
            再試行
          </button>
          <button type="button" onClick={onClose} style={{ ...closeButtonStyle, marginTop: 0 }}>
            閉じる
          </button>
        </div>
      </div>
    );
  }
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
  return (
    <WordDetailCard
      word={word}
      stage={stage}
      scheduling={scheduling}
      now={c.now()}
      audioUrl={clipUrl ?? undefined}
      onMarkUnknown={markUnknown}
      suspended={suspended}
      onMarkKnown={markKnown}
      onRestore={restoreWord}
      // A-3-2: single-word「次の文章に織り込む」— same Home injection path as the wordbook selection.
      onWeave={(id) => navigate('/', { state: { addWordIds: [id] } })}
      // C-2: tapping a semantic-network neighbor / cognate opens that word's card.
      onOpenWord={(w) => navigate(`/w/${encodeURIComponent(w.toLowerCase())}`)}
      onClose={onClose}
    />
  );
}

// ── Standalone word page (/w/:wordId — F-9 先行分; D-5・E-3 の URL 基盤) ─────────

/**
 * URL-addressable single word card. Reuses the shared WordDetailRoute body inside a
 * centered page container (same max width as the wordbook card) so the overlay and the
 * page render identical content (D-5). Close returns to the previous entry when there is
 * in-app history (`location.key !== 'default'`), otherwise to the wordbook. An unknown or
 * failed wordId renders a not-found empty state instead of loading forever.
 */
export function WordPageRoute(): ReactNode {
  const c = useContainer();
  const navigate = useNavigate();
  const location = useLocation();
  const { wordId } = useParams();
  const loadWord = useCallback((id: string) => loadAndCacheWordData(c, id), [c]);
  const { isError } = useWordData(loadWord, wordId ?? null);

  const onClose = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/wordbook');
  }, [location.key, navigate]);

  if (!wordId || isError) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>この単語は見つかりませんでした</div>
        <button type="button" onClick={() => navigate('/wordbook')} style={notFoundButtonStyle}>
          単語帳へ戻る
        </button>
      </div>
    );
  }

  return (
    <div style={wordPageStyle}>
      <WordDetailRoute wordId={wordId} onClose={onClose} />
    </div>
  );
}

// ── Settings / data management (F-5 第1段: backup export/import) ───────────────

/** Trigger a browser download of a Blob under the given filename. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** `lexia-backup-YYYYMMDD.json` for the given clock. */
function backupFilename(now: number): string {
  const date = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `lexia-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}

/**
 * Data-management route (F-5 第1段): connects the existing JsonSyncAdapter (`c.sync`) to the UI —
 * export downloads a backup file, import restores a chosen one (the screen gates it behind an
 * overwrite-confirmation modal). Success / failure feedback goes through the shared toast surface (D6).
 */
export function SettingsRoute(): ReactNode {
  const c = useContainer();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const generationMode = useStore(c.settings, (s) => s.generationMode);

  const onExport = async (includeImages: boolean): Promise<void> => {
    setExporting(true);
    try {
      const blob = await c.sync.export(c.userId, { includeImages });
      downloadBlob(blob, backupFilename(c.now()));
      showToast({ message: 'バックアップをダウンロードしました', tone: 'success' });
    } catch {
      showToast({ message: 'バックアップの書き出しに失敗しました', tone: 'error', durationMs: 0 });
    } finally {
      setExporting(false);
    }
  };

  const onImport = async (file: File): Promise<void> => {
    setImporting(true);
    try {
      await c.sync.import(c.userId, file);
      showToast({
        message: 'バックアップから復元しました。表示を最新にするには再読み込みしてください。',
        tone: 'success',
        durationMs: 0,
        action: { label: '再読み込み', onAction: () => window.location.reload() },
      });
    } catch {
      showToast({ message: '復元に失敗しました。ファイルを確認してください。', tone: 'error', durationMs: 0 });
    } finally {
      setImporting(false);
    }
  };

  return (
    <DataManagementScreen
      onExport={(includeImages) => void onExport(includeImages)}
      onImport={(file) => void onImport(file)}
      exporting={exporting}
      importing={importing}
    >
      <GenerationSettingsScreen mode={generationMode} onModeChange={(mode) => c.settings.getState().setGenerationMode(mode)} />
    </DataManagementScreen>
  );
}

// ── Catch-all 404 + route error boundary (F-9 先行分) ─────────────────────────

/** `path: '*'` fallback for unknown URLs — Japanese empty state with a home link. */
export function NotFoundRoute(): ReactNode {
  const navigate = useNavigate();
  return (
    <div style={notFoundStyle}>
      <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>ページが見つかりません</div>
      <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, maxWidth: 420, textAlign: 'center' }}>
        お探しのページは存在しないか、移動した可能性があります。
      </div>
      <button type="button" onClick={() => navigate('/')} style={notFoundButtonStyle}>
        ホームへ戻る
      </button>
    </div>
  );
}

/** Router `errorElement`: keeps a route render/loader error from blanking the screen. */
export function RouteErrorBoundary(): ReactNode {
  const error = useRouteError();
  useEffect(() => {
    if (error) console.error('Route error boundary caught:', error);
  }, [error]);
  return (
    <div style={notFoundStyle}>
      <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>問題が発生しました</div>
      <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, maxWidth: 420, textAlign: 'center' }}>
        画面を表示できませんでした。時間をおいてもう一度お試しください。
      </div>
      <a href="/" style={{ ...notFoundButtonStyle, display: 'inline-block', textDecoration: 'none' }}>
        ホームへ戻る
      </a>
    </div>
  );
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

const detailRetryButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.surfaceCard,
  background: colors.primary,
  border: `1px solid ${colors.primary}`,
  borderRadius: 8,
  padding: '8px 18px',
  cursor: 'pointer',
};

const wordPageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  background: colors.surfacePage,
  padding: '40px 24px',
};

// D-5: strip ModalOverlay's default card panel to a transparent wrapper sized to the WordDetailCard
// so the card's own surface/radius/shadow shows through (no nested double-card), and let the card own
// its内部スクロール (maxHeight 90vh) instead of the panel adding a second scroll container.
const wordOverlayPanelStyle: CSSProperties = {
  background: 'transparent',
  boxShadow: 'none',
  borderRadius: 0,
  maxWidth: 'min(780px, 100%)',
  width: '100%',
  maxHeight: 'none',
  overflowY: 'visible',
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

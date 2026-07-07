/**
 * L3 — generationController: wires the passage pipeline with staged readiness
 * (design.md Flow 1, task 10.1).
 *   Setup → SessionPlanner.buildRequest → GenerationOrchestrator (generate→validate→
 *   repair) → on success persist the passage and START READING IMMEDIATELY (text is
 *   viewable and lookup-able the moment validation passes), seed New scheduling states
 *   for the woven-in target words, open reading progress, and put the player into
 *   `loading`. Audio synthesis then runs in the background: when the TimingMap arrives
 *   the player flips to `ready`; if TTS fails the player is marked `unavailable` and the
 *   text reading continues to work (graceful degrade, task 10.4).
 *
 * The returned `audio` promise lets the caller await audio readiness without blocking the
 * text render — the UI renders on the synchronous return and reacts to `audio` later.
 */

import { sessionPlanner, type SessionPlanner } from '../../domain/session/sessionPlanner';
import { readabilityForCefr } from '../../domain/difficulty/levelPreset';
import type {
  GenerationOrchestrator,
  GenerationError,
  GenerationRunPhase,
} from '../../domain/generation/generationOrchestrator';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { persistImage } from '../../infra/persistence/imageStore';
import { ttsUnavailableReasonJa } from '../../infra/tts/ttsBackendHttp';
import { newSchedulingState } from './newState';
import type { SessionStore } from '../stores/sessionStore';
import type { PlayerStore } from '../stores/playerStore';
import type {
  SchedulingRepository,
  PassageRepository,
  ProgressRepository,
  TimingMapRepository,
  TtsSynthesisPort,
  ImageRepository,
} from '../../types/ports';
import type {
  AnnotationResult,
  IndexedPassage,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  ReadabilityLevel,
  SetupConfig,
  StoryContext,
  UserId,
  WordData,
  WordSchedulingState,
} from '../../types/domain';

export interface GenerationControllerDeps {
  /** Builds a fresh orchestrator bound to the given passageId. */
  createOrchestrator: (passageId: string) => GenerationOrchestrator;
  scheduling: SchedulingRepository;
  passages: PassageRepository;
  progress: ProgressRepository;
  timingMaps: TimingMapRepository;
  tts: TtsSynthesisPort;
  session: SessionStore;
  player: PlayerStore;
  now: () => number;
  /** Unique passage id generator (the orchestrator indexes against it). */
  genId: () => string;
  /** Voice to synthesize first (the default reading voice). */
  voiceId: string;
  /** Defaults to the singleton SessionPlanner. */
  planner?: SessionPlanner;
  /** Optional supplied word attributes for level control + cue grounding. */
  wordData?: Record<string, WordData>;
  /** Optional scene-illustration generator. Enrichment only; failures never block reading. */
  illustratePassage?: (req: PassageIllustrationRequest) => Promise<string>;
  /**
   * Staged delivery (設定「段階的に生成」): open the reader as soon as the body validates and run the
   * annotation pass in the background via `annotatePassage`, merging cues in when they land. Absent /
   * false ⇒ batch behavior (annotation awaited before the reader opens).
   */
  stagedGeneration?: boolean;
  /** Background annotation for the staged pipeline (usually ContentGateway.annotatePassage). */
  annotatePassage?: (req: PassageAnnotationRequest, signal?: AbortSignal) => Promise<AnnotationResult>;
  /** Cancels the in-flight generation (D-7): threaded to the orchestrator's ContentGateway calls. */
  signal?: AbortSignal;
  /** Reports the body-generation sub-phase (passage → repair → annotate) for the progress panel. */
  onPhase?: (phase: GenerationRunPhase) => void;
}

export interface GenerationOutcome {
  ok: boolean;
  passageId?: string;
  passage?: IndexedPassage;
  error?: GenerationError;
  /**
   * Resolves once the audio stage settles: true when audio+timing are ready, false when
   * TTS degraded. Present only when `ok` (text is already rendered by the time it settles).
   */
  audio?: Promise<boolean>;
  /** Resolves once scene illustration enrichment settles. Present only when configured. */
  illustration?: Promise<boolean>;
  /** Resolves once the staged background annotation settles. Present only in staged mode. */
  annotation?: Promise<boolean>;
}

export interface GenerationPipelineOptions {
  /** Optional fixed passage id, used for story chapters so the id is stable and readable. */
  passageId?: string;
  /** Optional story context threaded into SessionPlanner.buildRequest. */
  storyContext?: StoryContext;
}

export async function runGenerationPipeline(
  deps: GenerationControllerDeps,
  setup: SetupConfig,
  userId: UserId,
  options: GenerationPipelineOptions = {},
): Promise<GenerationOutcome> {
  const planner = deps.planner ?? sessionPlanner;
  const now = deps.now();

  // Gather (or seed) scheduling states for the target words — drives annotation density.
  const states: WordSchedulingState[] = [];
  const toSeed: WordSchedulingState[] = [];
  for (const wordId of setup.targetWordIds) {
    const existing = await deps.scheduling.get(userId, wordId);
    if (existing) {
      states.push(existing);
    } else {
      const seeded = newSchedulingState(userId, wordId, now);
      states.push(seeded);
      toSeed.push(seeded);
    }
  }

  const req = planner.buildRequest(setup, states, deps.wordData, options.storyContext);
  for (const state of toSeed) state.level = req.level;
  const passageId = options.passageId ?? deps.genId();
  // Staged mode (準備できたものから表示): the orchestrator returns as soon as the body validates
  // (annotationStatus 'pending'); the annotation joins audio + illustration as background work.
  const staged = Boolean(deps.stagedGeneration && deps.annotatePassage);
  const result = await deps
    .createOrchestrator(passageId)
    .generate(req, { signal: deps.signal, onPhase: deps.onPhase, deferAnnotation: staged });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const passage = attachStoryRef(result.value, options.storyContext);

  // Persist the passage, then render NOW (text viewable + lookup-able before audio).
  const record = { passageId, userId, createdAt: now, passage: passage.source };
  await deps.passages.put(record);
  // Seed New states so the woven-in words appear in the wordbook / dashboard breakdown.
  for (const s of toSeed) await deps.scheduling.upsert(s);

  deps.session.getState().startPassage(passage, now);
  const progress = deps.session.getState().toReadingProgress(userId);
  if (progress) await deps.progress.upsert(progress);

  deps.player.getState().setStatus('loading');
  const audio = synthesizeAudio(deps, passage);
  const illustration = deps.illustratePassage
    ? enrichPassageIllustration(deps, record, passage, options.storyContext)
    : undefined;
  const annotation = staged
    ? enrichPassageAnnotation(deps, record, req.readabilityLevel ?? readabilityForCefr(req.level))
    : undefined;

  return { ok: true, passageId, passage, audio, illustration, annotation };
}

function attachStoryRef(passage: IndexedPassage, storyContext?: StoryContext): IndexedPassage {
  if (!storyContext) return passage;
  return {
    ...passage,
    source: {
      ...passage.source,
      meta: {
        ...passage.source.meta,
        storyRef: {
          storyId: storyContext.storyId,
          chapterIndex: storyContext.chapterIndex,
        },
      },
    },
  };
}

/** Background audio stage: synthesize, persist the TimingMap, ready the player. */
async function synthesizeAudio(deps: GenerationControllerDeps, passage: IndexedPassage): Promise<boolean> {
  try {
    const { asset, timing } = await deps.tts.synthesize(passage, deps.voiceId);
    await deps.timingMaps.put(timing);
    deps.player.getState().load(asset, timing);
    return true;
  } catch (error) {
    // Degrade: keep the text readable; the listen bar says WHY narration is unavailable
    // (e.g. the picked voice's provider is not configured — no silent voice swap exists).
    deps.player.getState().setStatus('unavailable', ttsUnavailableReasonJa(error));
    return false;
  }
}

async function enrichPassageIllustration(
  deps: GenerationControllerDeps,
  record: { passageId: string; userId: UserId; createdAt: number; passage: IndexedPassage['source'] },
  passage: IndexedPassage,
  storyContext?: StoryContext,
): Promise<boolean> {
  if (!deps.illustratePassage || passage.source.sentences.length === 0) return false;
  try {
    const illustrationUrl = await deps.illustratePassage(buildPassageIllustrationRequest(passage, storyContext));
    // Staged enrichments run concurrently (annotation + illustration): merge onto the FRESH stored
    // record, never the captured one, so this write cannot clobber cues that landed meanwhile.
    const fresh = (await deps.passages.get(record.passageId)) ?? record;
    const enrichedSource = {
      ...fresh.passage,
      meta: {
        ...fresh.passage.meta,
        sceneIllustrationUrl: illustrationUrl,
      },
    };
    await deps.passages.put({ ...record, ...fresh, passage: enrichedSource });
    deps.session.getState().replacePassage(tokenizer.index(record.passageId, enrichedSource));
    return true;
  } catch {
    return false;
  }
}

/**
 * Staged-mode background annotation: annotate the persisted body, merge the cues / syntax notes /
 * status onto the FRESH stored record (an illustration may have landed first), persist, and refresh
 * the open reader via replacePassage. Failure stamps `annotationStatus: 'failed'` — visible in the
 * reader's banner with its 再生成 button — and never disturbs the already-readable text.
 */
async function enrichPassageAnnotation(
  deps: GenerationControllerDeps,
  record: { passageId: string; userId: UserId; createdAt: number; passage: IndexedPassage['source'] },
  readabilityLevel: ReadabilityLevel,
): Promise<boolean> {
  if (!deps.annotatePassage) return false;
  const source = record.passage;
  let result: AnnotationResult | null = null;
  try {
    const hardSentenceIndexes = source.syntaxSpans
      ? [...new Set(source.syntaxSpans.map((s) => s.sentenceIndex))].sort((a, b) => a - b)
      : undefined;
    result = await deps.annotatePassage({
      sentences: source.sentences,
      level: source.meta.level,
      readabilityLevel,
      hardSentenceIndexes,
      targetSpans: source.targetSpans,
      collocationSpans: source.collocationSpans,
      expressionSpans: source.expressionSpans,
    });
  } catch {
    result = null;
  }
  try {
    const fresh = (await deps.passages.get(record.passageId)) ?? record;
    const enrichedSource = {
      ...fresh.passage,
      ...(result ? { noticeCues: result.noticeCues } : {}),
      ...(result?.sentenceNotes && result.sentenceNotes.length > 0 ? { syntaxNotes: result.sentenceNotes } : {}),
      meta: { ...fresh.passage.meta, annotationStatus: result ? result.status : ('failed' as const) },
    };
    await deps.passages.put({ ...record, ...fresh, passage: enrichedSource });
    if (deps.session.getState().passage?.passageId === record.passageId) {
      deps.session.getState().replacePassage(tokenizer.index(record.passageId, enrichedSource));
    }
    return result !== null && result.status !== 'failed';
  } catch {
    return false;
  }
}

export interface BackfillIllustrationDeps {
  passages: PassageRepository;
  /** Image blob store (D7): the generated scene is stored here and referenced by `lexia-image:`. */
  images: ImageRepository;
  session: SessionStore;
  /** Scene-illustration generator. When absent, backfill is a no-op (enrichment unavailable). */
  illustratePassage?: (req: PassageIllustrationRequest) => Promise<string>;
  userId: UserId;
  now: () => number;
}

/**
 * E-3(e): backfill a scene illustration for a passage that was persisted WITHOUT one — its image API
 * call failed at generation time, or the passage predates illustrations. Loads the stored record and,
 * only while it still has no `sceneIllustrationUrl`, generates a scene, routes the bytes through the
 * `images` table (D7 / persistImage), stores the reference on the passage, and refreshes the active
 * reading session if it is still showing this passage. Idempotent (a stored illustration short-circuits
 * it) and never throws — a failure just leaves the passage un-illustrated (silent degrade; the manual
 * regenerate button remains the explicit path). Call sites dedupe per session per passageId so a
 * failed attempt isn't retried on every re-render. Returns true only when an illustration was stored.
 */
export async function backfillPassageIllustration(
  deps: BackfillIllustrationDeps,
  passageId: string,
  storyContext?: StoryContext,
): Promise<boolean> {
  if (!deps.illustratePassage) return false;
  try {
    const record = await deps.passages.get(passageId);
    if (!record || record.userId !== deps.userId) return false;
    if (record.passage.meta.sceneIllustrationUrl) return false;
    if (record.passage.sentences.length === 0) return false;

    const indexed = tokenizer.index(record.passageId, record.passage);
    const illustrationUrl = await deps.illustratePassage(buildPassageIllustrationRequest(indexed, storyContext));

    // Re-read before writing so a concurrent write (e.g. a manual regenerate that landed first) is
    // never clobbered — and skip storing the freshly generated image if one now exists.
    const fresh = await deps.passages.get(passageId);
    if (!fresh || fresh.userId !== deps.userId || fresh.passage.meta.sceneIllustrationUrl) return false;

    const storedUrl = (await persistImage(deps.images, deps.userId, illustrationUrl, deps.now())) ?? illustrationUrl;
    const enrichedSource = {
      ...fresh.passage,
      meta: { ...fresh.passage.meta, sceneIllustrationUrl: storedUrl },
    };
    await deps.passages.put({ ...fresh, passage: enrichedSource });
    if (deps.session.getState().passage?.passageId === passageId) {
      deps.session.getState().replacePassage(tokenizer.index(passageId, enrichedSource));
    }
    return true;
  } catch {
    return false;
  }
}

export function buildPassageIllustrationRequest(
  passage: IndexedPassage,
  storyContext?: StoryContext,
): PassageIllustrationRequest {
  const plan = storyContext?.plan;
  const chapter = plan?.chapters.find((item) => item.index === storyContext?.chapterIndex);
  return {
    title: passage.source.meta.title,
    intent: passage.source.meta.intent,
    level: passage.source.meta.level,
    sentences: passage.source.sentences,
    ...(plan
      ? {
          story: {
            genre: plan.genre,
            titleJa: plan.titleJa,
            synopsisJa: plan.synopsisJa,
            ...(chapter?.headingJa ? { chapterHeadingJa: chapter.headingJa } : {}),
            ...(chapter?.beatJa ? { chapterBeatJa: chapter.beatJa } : {}),
            characters: plan.characters.map((character) => ({
              name: character.name,
              role: character.role,
              descriptionJa: character.descriptionJa,
            })),
            styleHint: plan.homage?.styleNoteJa || plan.genre,
          },
        }
      : {}),
  };
}

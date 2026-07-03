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
import type { GenerationOrchestrator, GenerationError } from '../../domain/generation/generationOrchestrator';
import { newSchedulingState } from './newState';
import type { SessionStore } from '../stores/sessionStore';
import type { PlayerStore } from '../stores/playerStore';
import type {
  SchedulingRepository,
  PassageRepository,
  ProgressRepository,
  TimingMapRepository,
  TtsSynthesisPort,
} from '../../types/ports';
import type { IndexedPassage, SetupConfig, StoryContext, UserId, WordData, WordSchedulingState } from '../../types/domain';

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
      const seeded = newSchedulingState(userId, wordId);
      states.push(seeded);
      toSeed.push(seeded);
    }
  }

  const req = planner.buildRequest(setup, states, deps.wordData, options.storyContext);
  for (const state of toSeed) state.level = req.level;
  const passageId = options.passageId ?? deps.genId();
  const result = await deps.createOrchestrator(passageId).generate(req);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const passage = attachStoryRef(result.value, options.storyContext);

  // Persist the passage, then render NOW (text viewable + lookup-able before audio).
  await deps.passages.put({ passageId, userId, createdAt: now, passage: passage.source });
  // Seed New states so the woven-in words appear in the wordbook / dashboard breakdown.
  for (const s of toSeed) await deps.scheduling.upsert(s);

  deps.session.getState().startPassage(passage, now);
  const progress = deps.session.getState().toReadingProgress(userId);
  if (progress) await deps.progress.upsert(progress);

  deps.player.getState().setStatus('loading');
  const audio = synthesizeAudio(deps, passage);

  return { ok: true, passageId, passage, audio };
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
  } catch {
    // Degrade: keep the text readable; the player is simply unavailable.
    deps.player.getState().setStatus('unavailable');
    return false;
  }
}

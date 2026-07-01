/**
 * L0 — port interfaces (injection seams).
 *
 * The adjacent capabilities (Auth / Content / TTS) and Sync are seams; L2 adapters
 * implement these inward-facing interfaces and the UI never imports implementations
 * directly (design.md "Architecture"). Persistence repositories are seams too: all
 * writes go through a repository, reads may also use `useLiveQuery` at L3.
 */

import type {
  UserId,
  WordSchedulingState,
  ReviewLogEntry,
  GenerationRequest,
  GenerationResponse,
  WordData,
  WordSuggestionRequest,
  IndexedPassage,
  AudioAsset,
  TimingMap,
  PassageOutput,
  ReadingProgress,
  Settings,
  NoticeCue,
  PassageAnnotationRequest,
  StoryPlan,
  StoryPlanRequest,
  StoryRecord,
} from './domain';

// ── Adjacent capability seams ────────────────────────────────────────────────

/** Supplies the learner identity used to namespace all learning data. */
export interface AuthProvider {
  /** Resolves the current id (the `anonymous` namespace before sign-in). */
  getUserId(): Promise<UserId>;
  isAnonymous(): boolean;
  /** Subscribe to id changes (e.g. anonymous → signed-in). Returns an unsubscribe. */
  onUserChange(cb: (userId: UserId) => void): () => void;
}

/** Generation proxy + adjacent word-data supply. Credentials stay server-side. */
export interface ContentGateway {
  /** Calls the thin server proxy; the response carries `stopReason`. */
  generatePassage(req: GenerationRequest): Promise<GenerationResponse>;
  getWordData(wordId: string): Promise<WordData>;
  /**
   * Proposes new vocabulary (base-form lemmas) to teach for a level + theme when the learner
   * picked no target words. Optional so lightweight gateways/mocks need not implement it; the
   * caller falls back to a themed (word-free) passage when it is absent or fails.
   */
  suggestWords?(req: WordSuggestionRequest): Promise<string[]>;
  /**
   * Exhaustively annotate an already-generated passage with in-text "notice" cues (collocations,
   * idioms, phrasal verbs, connotation, register, grammar). The request carries the body-mark spans
   * (study words + collocations) as REQUIRED COVERAGE so the notice rail covers every in-text mark.
   * Optional so lightweight gateways/mocks need not implement it; enrichment is skipped when absent.
   */
  annotatePassage?(req: PassageAnnotationRequest): Promise<NoticeCue[]>;
}

/**
 * Story-plan generation proxy (Requirement 6). Optional/adjacent to ContentGateway: it produces the
 * character/plot/chapter scaffold BEFORE the body text. Credentials stay server-side; when the port
 * is unconfigured the caller errors (no mock fallback), per the project's generation policy.
 */
export interface StoryGateway {
  /** Generate a story plan (characters, synopsis, chapters) for the requested type/genre/homage. */
  planStory(req: StoryPlanRequest): Promise<StoryPlan>;
}

/** Persistence of confirmed story plans (`stories` store). */
export interface StoryRepository {
  get(storyId: string): Promise<StoryRecord | undefined>;
  put(record: StoryRecord): Promise<void>;
  /** Most-recently created stories first for a learner. */
  recent(userId: UserId, limit: number): Promise<StoryRecord[]>;
}

/** Audio synthesis + token-resolved timing maps. */
export interface TtsSynthesisPort {
  /** Synthesize passage×voice and return a token-resolved TimingMap. */
  synthesize(
    passage: IndexedPassage,
    voiceId: string,
  ): Promise<{ asset: AudioAsset; timing: TimingMap }>;
  /** Single-word pronunciation clip url (adjacent supply or pre-generated). */
  wordClipUrl(wordId: string, voiceId: string): Promise<string>;
}

/** Local backup seam: JSON export/import (real cloud sync is future work). */
export interface SyncAdapter {
  export(userId: UserId): Promise<Blob>;
  import(userId: UserId, blob: Blob): Promise<void>;
}

// ── Persistence repositories ─────────────────────────────────────────────────

export interface SchedulingRepository {
  get(userId: UserId, wordId: string): Promise<WordSchedulingState | undefined>;
  upsert(state: WordSchedulingState): Promise<void>;
  /** Words due at/before `at`, due-soonest first ("today's review"). */
  dueBefore(userId: UserId, at: number): Promise<WordSchedulingState[]>;
  /** Lowest-stability words first (candidate selection). */
  lowStability(userId: UserId, limit: number): Promise<WordSchedulingState[]>;
}

/** Read-only subset of the review log (cooldown / replay reads). */
export interface ReviewLogReader {
  lastPassageUpdate(userId: UserId, wordId: string): Promise<number | undefined>;
}

/** Append-only review log (FSRS replay, loss recovery, double-count cooldown). */
export interface ReviewLogRepository extends ReviewLogReader {
  append(entry: ReviewLogEntry): Promise<void>;
  since(userId: UserId, from: number): Promise<ReviewLogEntry[]>;
}

/** Persistence envelope for a generated passage (normalized storage). */
export interface PassageRecord {
  passageId: string;
  userId: UserId;
  createdAt: number;
  passage: PassageOutput;
}

export interface PassageRepository {
  get(passageId: string): Promise<PassageRecord | undefined>;
  put(record: PassageRecord): Promise<void>;
  /** Most-recently created passages first. */
  recent(userId: UserId, limit: number): Promise<PassageRecord[]>;
}

export interface TimingMapRepository {
  get(passageId: string, voiceId: string): Promise<TimingMap | undefined>;
  put(timing: TimingMap): Promise<void>;
}

export interface ProgressRepository {
  get(userId: UserId, passageId: string): Promise<ReadingProgress | undefined>;
  upsert(progress: ReadingProgress): Promise<void>;
  byStatus(userId: UserId, status: ReadingProgress['status']): Promise<ReadingProgress[]>;
}

export interface SettingsRepository {
  get(userId: UserId): Promise<Settings | undefined>;
  put(settings: Settings): Promise<void>;
}

export interface WordCacheRepository {
  get(userId: UserId, wordId: string): Promise<WordData | undefined>;
  put(userId: UserId, data: WordData): Promise<void>;
  all(userId: UserId): Promise<WordData[]>;
}

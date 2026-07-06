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
  AnnotationResult,
  PassageAnnotationRequest,
  ReviewSentenceRequest,
  CharacterIllustrationRequest,
  PassageIllustrationRequest,
  StoryPlan,
  StoryPlanExtensionRequest,
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

/** Result of the generation-proxy config probe (GET /api/health). Never exposes the key value. */
export interface GenerationHealth {
  configured: boolean;
  provider: 'openai' | 'anthropic';
}

/** Generation proxy + adjacent word-data supply. Credentials stay server-side. */
export interface ContentGateway {
  /**
   * Calls the thin server proxy; the response carries `stopReason`. An optional `AbortSignal`
   * cancels the in-flight request (D-7): the orchestrator threads through the generation-progress
   * store's controller so a learner can abort a long generation, and each request also carries a
   * built-in timeout.
   */
  generatePassage(req: GenerationRequest, signal?: AbortSignal): Promise<GenerationResponse>;
  getWordData(wordId: string): Promise<WordData>;
  /**
   * Lightweight config probe (GET /api/health) used to warn the learner up-front when the
   * generation API key is unset. Optional so lightweight gateways/mocks need not implement it; the
   * caller skips the warning banner when it is absent.
   */
  checkHealth?(): Promise<GenerationHealth>;
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
   * Accepts the same optional `AbortSignal` as `generatePassage` so a cancelled generation also
   * aborts its annotation pass.
   */
  annotatePassage?(req: PassageAnnotationRequest, signal?: AbortSignal): Promise<AnnotationResult>;
  /**
   * Generate a scene illustration for an accepted passage, returning a base64 `data:` URL. Optional
   * enrichment so lightweight gateways/mocks need not implement it; failure never blocks reading.
   */
  illustratePassage?(req: PassageIllustrationRequest): Promise<string>;
  /**
   * Generate a single fresh review-context sentence for a word (C-5c). Optional so lightweight
   * gateways/mocks need not implement it; the review-material chain skips this tier when absent or
   * when it rejects, falling through to the bare-headword last resort.
   */
  reviewSentence?(req: ReviewSentenceRequest): Promise<string>;
}

/**
 * Story-plan generation proxy (Requirement 6). Optional/adjacent to ContentGateway: it produces the
 * character/plot/chapter scaffold BEFORE the body text. Credentials stay server-side; when the port
 * is unconfigured the caller errors (no mock fallback), per the project's generation policy.
 */
export interface StoryGateway {
  /** Generate a story plan (characters, synopsis, chapters) for the requested type/genre/homage. */
  planStory(req: StoryPlanRequest): Promise<StoryPlan>;
  /** Extend an existing long-story plan with additional future chapter beats. */
  extendStoryPlan?(req: StoryPlanExtensionRequest): Promise<StoryPlan>;
  /**
   * Generate one character image (portrait or full body by request variant), returning a base64
   * `data:` URL (Requirement 6.8). Optional enrichment (like ContentGateway.annotatePassage) so
   * lightweight gateways/mocks need not implement it; when absent, illustration is skipped.
   * Credentials stay server-side; a missing/broken image API rejects (no mock fallback) and the
   * caller degrades to no image.
   */
  illustrateCharacter?(req: CharacterIllustrationRequest): Promise<string>;
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

/** Options for a backup export (F-5 第2段). */
export interface SyncExportOptions {
  /**
   * Include illustration bytes (the `images` table) in the backup. Default true. When false the
   * export omits the images table AND null-outs every image reference field on passages/stories, so a
   * text-only backup stays small (acceptance target: ≤1/10 the size of an image-bearing one).
   */
  includeImages?: boolean;
}

/** Local backup seam: JSON export/import (real cloud sync is future work). */
export interface SyncAdapter {
  export(userId: UserId, options?: SyncExportOptions): Promise<Blob>;
  import(userId: UserId, blob: Blob): Promise<void>;
}

/**
 * Persistence envelope for one illustration blob (F-5 第3段 / D7). Records reference it by
 * `lexia-image:<imageId>`; the bytes live here as a Blob instead of an inline base64 data URL.
 */
export interface ImageRecord {
  imageId: string;
  userId: UserId;
  blob: Blob;
  mime: string;
  createdAt: number;
}

/** Blob-backed illustration store (F-5 第3段). One row per stored image, referenced by imageId. */
export interface ImageRepository {
  get(imageId: string): Promise<ImageRecord | undefined>;
  put(record: ImageRecord): Promise<void>;
  /** Every image blob for a learner (backup export). */
  all(userId: UserId): Promise<ImageRecord[]>;
  /** Remove a stored image (no-op when absent). */
  delete(imageId: string): Promise<void>;
}

// ── Persistence repositories ─────────────────────────────────────────────────

export interface SchedulingRepository {
  get(userId: UserId, wordId: string): Promise<WordSchedulingState | undefined>;
  upsert(state: WordSchedulingState): Promise<void>;
  /** Words due at/before `at`, due-soonest first ("today's review"). */
  dueBefore(userId: UserId, at: number): Promise<WordSchedulingState[]>;
  /** Lowest-stability words first (candidate selection). */
  lowStability(userId: UserId, limit: number): Promise<WordSchedulingState[]>;
  /**
   * Count words first seeded at/after `from` (C-5b): the day's new-word tally that clamps
   * generation to `DAILY_NEW_WORD_LIMIT`. Optional so lightweight fakes need not implement it; a
   * missing implementation disables the clamp (treated as 0 seeds today).
   */
  countSeededSince?(userId: UserId, from: number): Promise<number>;
}

/** Read-only subset of the review log (cooldown / replay reads). */
export interface ReviewLogReader {
  /**
   * Latest timestamp of ANY entry for a word — review, passage or undo (C-5d cross-source cooldown).
   * `undefined` when the word has no log entries.
   */
  lastUpdate(userId: UserId, wordId: string): Promise<number | undefined>;
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
  /** Every passage for a learner, most-recently created first (library + search input). */
  all(userId: UserId): Promise<PassageRecord[]>;
  /** Story chapters for a learner, ordered by chapter index. */
  byStory(userId: UserId, storyId: string): Promise<PassageRecord[]>;
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

/** Non-indexed cache metadata carried alongside a stored WordData row (design decision D2). */
export interface WordCacheMeta {
  /** WordData contract version the row was written under (undefined ⇒ legacy v1). */
  schemaVersion?: number;
  /** True when the stored data does not yet meet the current contract; refresh in the background. */
  enrichmentPending?: boolean;
}

/** WordData plus its cache metadata, as returned by the repository on read. */
export type CachedWordData = WordData & WordCacheMeta;

export interface WordCacheRepository {
  get(userId: UserId, wordId: string): Promise<CachedWordData | undefined>;
  put(userId: UserId, data: WordData, meta?: WordCacheMeta): Promise<void>;
  all(userId: UserId): Promise<WordData[]>;
}

/** A cached suggestion-LLM proposal pool for one `${level}|${intent}` key (E-3(c)). */
export interface CachedSuggestion {
  /** New-word lemmas the suggestion LLM returned for the key's (level, intent). */
  proposals: string[];
  /** ISO timestamp the proposals were fetched; drives WordSuggestionService's 24h TTL. */
  updatedAt: string;
}

/**
 * Cache-first store for suggestion-LLM proposals (E-3(c)). Keyed by learner + suggestion key so the
 * setup preview and generation-time auto-selection reuse one LLM call per (level, intent) TTL window.
 */
export interface SuggestionCacheRepository {
  get(userId: UserId, suggestionKey: string): Promise<CachedSuggestion | undefined>;
  put(userId: UserId, suggestionKey: string, entry: CachedSuggestion): Promise<void>;
}

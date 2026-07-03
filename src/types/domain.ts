/**
 * L0 — pure domain types (no dependencies).
 *
 * Single source of truth for the data contracts shared across the app. Values mirror
 * design.md "Data Models → Logical Data Model". Annotations use a sentence/token-index
 * model (never character offsets) so the renderer, TTS mark resolution and recall
 * hit-testing share one deterministic token definition (see TokenizerJoinService).
 */

// ── Identifiers & scalars ────────────────────────────────────────────────────

/** Branded learner id supplied by the adjacent AuthProvider. */
export type UserId = string & { readonly __brand: 'UserId' };

/** Stable token identity: `passageId:sentenceIndex:tokenIndex`. */
export type TokenId = string;

export type Cefr = 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Sentence-structure/readability band, separate from vocabulary difficulty. */
export type ReadabilityLevel = 'easy' | 'standard' | 'advanced';

/** Optional advanced overrides. Unset means "derive from the selected exam target". */
export interface AdvancedDifficulty {
  /** Overrides the CEFR vocabulary band used for generation/validation. */
  vocabularyLevel?: Cefr;
  /** Overrides sentence length, clause density, and structural complexity. */
  readabilityLevel?: ReadabilityLevel;
}

// ── Exam-based difficulty (Requirement 9) ────────────────────────────────────

/** Standardized exam whose scale a learner may use to pick difficulty. */
export type ExamKind = 'eiken' | 'toeic' | 'toefl' | 'ielts';

/**
 * Exam-based difficulty selection (Requirement 9). The UI selects/presents difficulty by exam
 * scale; the generator/validator still run on the internal `Cefr` pivot, derived via
 * `examScale.examToCefr`. `value` is the exam-specific choice ('準1' / '785' / '72' / '6.0').
 */
export interface ExamCriterion {
  kind: ExamKind;
  value: string;
}

// ── Learning intent & content type (Requirements 7/8) ────────────────────────

/**
 * Closed enumeration of learning intents (Requirement 8), replacing the fine-grained
 * free-text theme tags. Drives subject-matter + register (and, for exam intents, the
 * high-frequency vocabulary/format bias). Orthogonal to difficulty.
 */
export type LearningIntent = 'business' | 'daily' | 'toeic' | 'eiken' | 'academic' | 'travel';

/** Content kind (Requirement 6). Articles carry no story-only fields (type-level exclusivity). */
export type ContentType = 'article' | 'short_story' | 'long_story';

/** Story genre (Requirement 6.4). Open string so custom genres beyond the required three are allowed. */
export type StoryGenre = 'fantasy' | 'sci_fi' | 'mystery' | (string & {});

/** Four-stage mastery (most important semantic). */
export type MasteryStage = 'New' | 'Learning' | 'Consolidating' | 'Mastered';

/** 4→3 downcast used to drive generated-annotation density. */
export type MasteryDensity = 'new' | 'review' | 'known';

/** FSRS grade: Again / Hard / Good / Easy. */
export type Rating = 1 | 2 | 3 | 4;

// ── Scheduling aggregate ─────────────────────────────────────────────────────

export interface WordSchedulingState {
  userId: UserId;
  wordId: string;
  /** CEFR vocabulary band when this word entered the learner's study set. */
  level?: Cefr;
  /** S in days. `undefined` ⇒ New (not yet learned). */
  stability?: number;
  /** D in 1..10. */
  difficulty: number;
  reps: number;
  lapses: number;
  /** Index into the first-display learning-step ladder; 0 once graduated. */
  learningStep: number;
  lastReviewAt: number;
  dueAt: number;
  lastSource: 'review' | 'passage';
  /** Derived stage, denormalized for indexed querying. */
  mastery: MasteryStage;
  /** Times this word has reappeared across passages (6.4). */
  reappearCount: number;
}

/** Append-only review event (FSRS replay, loss recovery, double-count cooldown). */
export interface ReviewLogEntry {
  /** Dexie auto-increment key (assigned on append). */
  id?: number;
  userId: UserId;
  wordId: string;
  rating: Rating;
  source: 'review' | 'passage';
  at: number;
  stabilityAfter?: number;
}

// ── Passage generation output (no char offsets) ──────────────────────────────

export interface PassageMeta {
  title: string;
  /** Learning intent this passage serves (was: `theme: string`; Dexie index replaced too). */
  intent: LearningIntent;
  level: Cefr;
  newCount: number;
  reviewCount: number;
  approxWords: number;
  /** Link to the owning story chapter (Requirement 6.6). Absent for standalone articles. */
  storyRef?: { storyId: string; chapterIndex: number };
}

/**
 * Translation-side emphasis span (Requirement 4 / 9.5). Marks a slice of the sentence's
 * `translationJa` that corresponds to an English-side annotated expression, so a「新出」word
 * can be underlined in the Japanese translation too. Offsets are UTF-16 code-unit positions
 * into `translationJa` — RE-DERIVED server-side from the model's verbatim JA anchor text (the
 * model miscounts offsets), mirroring how NoticeCue spans are re-anchored from `anchorText`.
 */
export interface TranslationSpan {
  /** UTF-16 offset of the emphasis start within `translationJa`. */
  charStart: number;
  /** UTF-16 offset of the emphasis end (exclusive) within `translationJa`. */
  charEnd: number;
  /** Which kind of English-side expression this emphasis mirrors. */
  refType: 'word' | 'collocation' | 'idiom' | 'grammar';
  /** Link to the English-side target word (when the emphasis mirrors a TargetSpan, 4.2). */
  wordId?: string;
  /** True only for genuinely new elements; review/known elements get no JA emphasis (4.4). */
  isNew: boolean;
}

export interface Sentence {
  tokens: string[];
  translationJa: string;
  /**
   * Optional translation-side emphasis spans (Requirement 4). Absent ⇒ no JA-side emphasis,
   * keeping passages generated before this feature valid.
   */
  translationSpans?: TranslationSpan[];
}

/** Half-open token range `[tokenStart, tokenEnd)` within one sentence. */
export interface SpanRef {
  sentenceIndex: number;
  tokenStart: number;
  tokenEnd: number;
}

export interface TargetSpan extends SpanRef {
  wordId: string;
  surface: string;
  masteryDensity: MasteryDensity;
  /** Optional reappearance supplement for consolidation UI (6.4). */
  reappearInfo?: { count: number; noteJa?: string };
}

export interface CollocationSpan extends SpanRef {
  headWordId: string;
  collocationId: string;
}

export type NoticeCategory =
  | 'connotation'
  | 'collocation'
  | 'register'
  | 'etymology'
  | 'semantic_network'
  | 'synonym_nuance'
  | 'grammar_pattern'
  | 'word_family'
  | 'frequency'
  | 'common_error'
  | 'idiom'
  | 'phrasal_verb'
  | 'phrase'
  | 'metaphor'
  | 'usage'
  | 'memory_tip'
  | 'sentence_structure';

export interface NoticeCue {
  index: number;
  span: SpanRef;
  category: NoticeCategory;
  /**
   * Legacy target-word grounding link: the word this cue annotates. Only the old target-word cue
   * path set it; exhaustive annotation-pass cues omit it (they are not bound to a target word).
   */
  wordId?: string;
  /** Legacy target-word grounding key (the WordData attribute that attested this cue). */
  sourceAttribute?: string;
  /**
   * The exact expression in the passage this cue is about, copied verbatim from the sentence's
   * tokens. `span` is RE-DERIVED from this text (not from the model's raw token indices, which it
   * miscounts), so the in-text badge and the NoticeRail expression always match `explanationJa`.
   * Invariant (enforced by PassageValidator): the tokens at `span` render exactly `anchorText`.
   */
  anchorText: string;
  explanationJa: string;
}

export interface PassageOutput {
  meta: PassageMeta;
  sentences: Sentence[];
  targetSpans: TargetSpan[];
  collocationSpans: CollocationSpan[];
  noticeCues: NoticeCue[];
}

// ── Story scaffold (Requirement 6) ───────────────────────────────────────────

/** A character in a generated story plan. */
export interface StoryCharacter {
  name: string;
  role: string;
  descriptionJa: string;
  /**
   * Generated portrait as a base64 `data:` URL (Requirement 6.8). Optional enrichment: absent when
   * illustration is disabled, unconfigured, or the image call failed. Stored inline with the plan
   * (the sole deliberate exception to lexiaDb's "blobs are never stored" convention — there is no CDN).
   */
  illustrationUrl?: string;
}

/** One chapter's heading + beat in the story plan (short stories have a single element). */
export interface ChapterPlan {
  index: number;
  headingJa: string;
  beatJa: string;
}

/**
 * A story plan (Requirement 6.2): characters, synopsis and chapter structure generated
 * BEFORE the body text and confirmed by the learner (6.3). Persisted in the `stories` store
 * only after confirmation.
 */
export interface StoryPlan {
  storyId: string;
  contentType: Exclude<ContentType, 'article'>;
  genre: StoryGenre;
  /** Reference to an existing novel homage — style/motif only, never verbatim copy (6.5). */
  homage?: { title: string; styleNoteJa: string };
  titleJa: string;
  synopsisJa: string;
  characters: StoryCharacter[];
  /** Chapter headings/beats (short story ⇒ one element; long story ⇒ many). */
  chapters: ChapterPlan[];
}

/** Consistency context supplied to each chapter's generation (6.6). */
export interface StoryContext {
  storyId: string;
  chapterIndex: number;
  plan: StoryPlan;
  /** Summary of prior chapters (long-story consistency supply). */
  priorSummaryJa?: string;
}

/** Request for a story plan (Requirement 6.2). */
export interface StoryPlanRequest {
  contentType: Exclude<ContentType, 'article'>;
  genre: StoryGenre;
  homageTitle?: string;
  intent: LearningIntent;
  level: Cefr;
}

/** Request to extend an existing long-story plan when the next chapter beat is missing. */
export interface StoryPlanExtensionRequest {
  plan: StoryPlan;
  /** First chapter index that must be newly planned. */
  nextChapterIndex: number;
  /** Summary of already generated chapters, used to continue the plot coherently. */
  priorSummaryJa?: string;
  /** Number of additional chapter beats to append. */
  additionalChapters?: number;
}

/** Request for a single character's portrait illustration (Requirement 6.8). */
export interface CharacterIllustrationRequest {
  name: string;
  role: string;
  descriptionJa: string;
  genre: StoryGenre;
  /** Style/motif hint (from the plan's homage note or genre) to keep the cast visually coherent. */
  styleHint?: string;
}

/** Persistence envelope for a confirmed story plan (`stories` store). */
export interface StoryRecord {
  storyId: string;
  userId: UserId;
  createdAt: number;
  plan: StoryPlan;
}

// ── Tokenizer index (single token truth source) ──────────────────────────────

/** Half-open byte range `[start, end)` in the UTF-8 stream the TTS engine sees. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface IndexedToken {
  tokenId: TokenId;
  sentenceIndex: number;
  tokenIndex: number;
  text: string;
  /** UTF-16 code-unit offsets into the passage render string (JS rendering). */
  charStart: number;
  charEnd: number;
  /** UTF-8 byte offsets into the passage render string (Polly input). */
  byteStart: number;
  byteEnd: number;
}

export interface IndexedSentence {
  sentenceIndex: number;
  renderText: string;
  tokens: IndexedToken[];
}

export interface IndexedPassage {
  passageId: string;
  /** Whole-passage rendered string (sentences joined deterministically). */
  renderText: string;
  sentences: IndexedSentence[];
  /** Flattened tokens in reading order (binary-searchable by char/byte). */
  tokens: IndexedToken[];
  source: PassageOutput;
}

export type TokenResolveError = { kind: 'no_token' | 'multi_token'; byteRange: ByteRange };

// ── Audio timing ─────────────────────────────────────────────────────────────

export interface AudioAsset {
  passageId: string;
  voiceId: string;
  audioUrl: string;
  format: 'audio/mpeg' | 'audio/aac';
  durationMs: number;
  engine: 'polly' | 'azure';
}

export interface WordMark {
  tokenId: TokenId;
  startMs: number;
  endMs: number;
}

export interface TimingMap {
  passageId: string;
  voiceId: string;
  marks: WordMark[];
}

// ── External word data (reference only; MORE optional ⇒ degradation-tolerant) ─

export interface WordData {
  wordId: string;
  headword: string;
  ipa: string;
  pos: string[];
  register: string;
  connotation: string;
  /** 1..5. */
  frequency: number;
  audioUrl?: string;
  illustrationUrl?: string;
  memoryTips?: {
    kind: 'image' | 'etymology' | 'collocation' | 'contrast' | 'sound' | 'mistake';
    tipJa: string;
  }[];
  core: {
    meaningsJa: string[];
    examples: { en: string; ja: string }[];
    collocations: string[];
    synonymNuances: string[];
  };
  more?: Partial<{
    etymology: { prefix?: string; root?: string; suffix?: string; noteJa?: string };
    semanticNetwork: {
      synonyms: string[];
      antonyms: string[];
      hypernyms: string[];
      hyponyms: string[];
      related: string[];
    };
    wordFamily: string[];
    idioms: string[];
    grammarPatterns: string[];
    metaphor: string;
    commonErrors: string[];
  }>;
}

// ── Progress & settings ──────────────────────────────────────────────────────

export interface ReadingProgress {
  userId: UserId;
  passageId: string;
  sentenceIndex: number;
  percent: number;
  status: 'in_progress' | 'completed';
  startedAt: number;
  completedAt?: number;
}

export interface SetupConfig {
  /** Exam-based difficulty (Requirement 9). Mapped to `Cefr` at generation time. Was: `level: Cefr`. */
  examTarget: ExamCriterion;
  /** Single learning intent (Requirement 8). Was: `themes: string[]`. */
  intent: LearningIntent;
  newWordRatio: number;
  /** 100-word-step word count (Requirement 7). Was: `length: 'short'|'medium'|'long'`. */
  wordTarget: number;
  /** Content kind (Requirement 6). */
  contentType: ContentType;
  /** Advanced overrides for vocabulary level and sentence-structure readability. */
  advancedDifficulty?: AdvancedDifficulty;
  /** Genre/homage for stories (unused for articles). */
  storyOptions?: { genre: StoryGenre; homageTitle?: string };
  targetWordIds: string[];
  excludedWordIds: string[];
}

export interface Settings {
  userId: UserId;
  translationMode: 'off' | 'per_sentence' | 'full';
  fontScale: number;
  voiceId: string;
  rate: number;
  theme: 'light' | 'dark' | 'system';
  locale: string;
  lastSetup: SetupConfig;
}

// ── Generation request/response (assembled by SessionPlanner) ────────────────

export interface GenerationTargetWord {
  wordId: string;
  surface: string;
  masteryDensity: MasteryDensity;
  /** Supplied vocabulary attributes used for level control + cue grounding. */
  attributes?: Record<string, unknown>;
}

export interface GenerationRequest {
  level: Cefr; // resolved from SetupConfig.examTarget via examScale (internal pivot)
  /** Single learning intent (Requirement 8). Was: `themes: string[]`. */
  intent: LearningIntent;
  newWordRatio: number;
  /** 100-word-step word count (Requirement 7). Was: `length: 'short'|'medium'|'long'`. */
  wordTarget: number;
  /** Content kind (Requirement 6). */
  contentType: ContentType;
  /** Sentence-structure/readability band resolved from setup advanced settings or exam target. */
  readabilityLevel?: ReadabilityLevel;
  targetWords: GenerationTargetWord[];
  /** Story-chapter consistency context (Requirement 6.6). Unset for standalone articles. */
  storyContext?: StoryContext;
  /**
   * Set by the orchestrator on a repair attempt: human-readable descriptions of the
   * violations the previous generation hit, fed back into the prompt so the model fixes
   * them instead of being asked to regenerate blind. Absent on the first attempt.
   */
  repairFeedback?: string[];
}

/**
 * Input to the exhaustive annotation pass: the finished passage's tokenized sentences plus its
 * CEFR level. The proxy runs a second model call over this and returns location-anchored NoticeCues.
 *
 * `targetSpans` / `collocationSpans` are the expressions the reading UI already marks (study-word
 * underlines, collocation tints). They are passed as REQUIRED COVERAGE so every body mark also gets
 * a「気づき」cue — keeping the in-text marking and the notice rail one consistent set (no
 * "this collocation is explained but that one isn't").
 */
export interface PassageAnnotationRequest {
  sentences: Sentence[];
  level: Cefr;
  targetSpans?: TargetSpan[];
  collocationSpans?: CollocationSpan[];
}

/**
 * Asks the proxy to propose new vocabulary (base-form lemmas) to teach when the learner
 * starts from a level + theme without hand-picking target words. The proposed words are
 * then fetched as WordData and woven into the passage (and seeded into the SRS).
 */
export interface WordSuggestionRequest {
  level: Cefr;
  /** Single learning intent (Requirement 8). Was: `themes: string[]`. */
  intent: LearningIntent;
  /** How many lemmas to propose. */
  count: number;
  /** Lemmas to avoid (already excluded/known); lowercase. */
  exclude?: string[];
}

// ── Word suggestion (Requirement 5) ──────────────────────────────────────────

/** Why a word was selected for the setup candidate list. */
export type CandidateReason = 'new' | 'due' | 'weak';

/** A suggested word to weave in (base-form lemma + display surface). */
export interface CandidateWord {
  wordId: string;
  surface: string;
  /** CEFR band used to decide whether the candidate fits the current target level. */
  level?: Cefr;
  /** Source of the suggestion: new LLM proposal, due review, or low-stability weak word. */
  reason?: CandidateReason;
  /** Current mastery for scheduled words; absent for brand-new proposals. */
  stage?: MasteryStage;
}

export interface SuggestionInput {
  userId: UserId;
  level: Cefr;
  intent: LearningIntent;
  /** Current time, used to include due review words. */
  now: number;
  /** Words the learner already excluded (lowercase lemma). */
  excludedWordIds: string[];
  /** How many candidates to present. */
  count: number;
  /** Desired new/review target derived from wordTarget × newWordRatio, capped by `count`. */
  desiredNewCount?: number;
}

export interface SuggestionResult {
  /** ABC-ordered, deduped candidates with introduced/excluded words removed. */
  candidates: CandidateWord[];
  /** Present when fewer than `count` candidates were available (Requirement 5.5). */
  shortfall?: { requested: number; available: number; reason: 'exhausted' | 'gateway_unavailable' };
}

/** Anthropic-style stop reasons relevant to generation gating. */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'refusal'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn';

export interface GenerationResponse {
  passage: PassageOutput;
  stopReason: StopReason;
}

// ── Recall (reading-time) signals ────────────────────────────────────────────

export type RecallSignal =
  | { kind: 'lookup'; wordId: string; at: number }
  | { kind: 'read_through'; wordId: string; at: number };

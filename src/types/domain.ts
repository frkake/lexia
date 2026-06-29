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
  theme: string;
  level: Cefr;
  newCount: number;
  reviewCount: number;
  approxWords: number;
}

export interface Sentence {
  tokens: string[];
  translationJa: string;
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
  | 'phrasal_verb';

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
  core: {
    meaningsJa: string[];
    examples: { en: string; ja: string }[];
    collocations: string[];
    synonymNuances: string[];
  };
  more?: Partial<{
    etymology: { prefix?: string; root?: string; suffix?: string };
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
  level: Cefr;
  themes: string[];
  newWordRatio: number;
  length: 'short' | 'medium' | 'long';
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
  level: Cefr;
  themes: string[];
  newWordRatio: number;
  length: 'short' | 'medium' | 'long';
  targetWords: GenerationTargetWord[];
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
 */
export interface PassageAnnotationRequest {
  sentences: Sentence[];
  level: Cefr;
}

/**
 * Asks the proxy to propose new vocabulary (base-form lemmas) to teach when the learner
 * starts from a level + theme without hand-picking target words. The proposed words are
 * then fetched as WordData and woven into the passage (and seeded into the SRS).
 */
export interface WordSuggestionRequest {
  level: Cefr;
  themes: string[];
  /** How many lemmas to propose. */
  count: number;
  /** Lemmas to avoid (already excluded/known); lowercase. */
  exclude?: string[];
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

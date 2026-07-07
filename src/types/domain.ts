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

/** Position within a CEFR band (A-3-1): bottom / middle / top third of the band. */
export type LevelSubBand = 'low' | 'mid' | 'high';

/** Optional advanced overrides. Unset means "derive from the selected exam target". */
export interface AdvancedDifficulty {
  /** Overrides the CEFR vocabulary band used for generation/validation. */
  vocabularyLevel?: Cefr;
  /** Overrides sentence length, clause density, and structural complexity. */
  readabilityLevel?: ReadabilityLevel;
}

// ── Listening audio variants ─────────────────────────────────────────────────

/** English accent/variety the learner wants to practice hearing. */
export type EnglishAccent = 'us' | 'gb' | 'au' | 'in';

export type VoiceGender = 'female' | 'male';

export type VoiceProvider = 'azure' | 'polly' | 'openai';

export type VoiceRole = 'narrator' | 'interviewer' | 'guest' | 'announcer';

export interface VoiceProfile {
  id: string;
  labelJa: string;
  accent: EnglishAccent;
  gender: VoiceGender;
  role: VoiceRole;
  provider: VoiceProvider;
  providerVoiceId: string;
  locale: string;
}

export type ListeningSceneKind =
  | 'radio_news'
  | 'street_interview'
  | 'podcast_dialogue'
  | 'public_announcement'
  | 'casual_conversation'
  | 'tv_broadcast';

export type AmbientNoiseLevel = 'none' | 'low' | 'medium';

export interface ListeningOptions {
  sceneKind: ListeningSceneKind;
  noiseLevel: AmbientNoiseLevel;
  accent: EnglishAccent;
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

/** Content kind (Requirement 6 + listening scenes). Articles carry no story-only fields. */
export type ContentType = 'article' | 'short_story' | 'long_story' | 'listening_scene';

/** Story genre (Requirement 6.4). Open string so custom genres beyond the required three are allowed. */
export type StoryGenre = 'fantasy' | 'sci_fi' | 'mystery' | (string & {});

export type StoryContentType = 'short_story' | 'long_story';

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
  /**
   * Wall-clock ms when this word was first seeded into the study set (C-5b). Powers the per-day
   * new-word count that clamps generation to `DAILY_NEW_WORD_LIMIT`. Absent on legacy rows and on
   * transient (now-omitted) seeds; a re-woven existing seed keeps its original value (it is not
   * re-seeded), so it does not consume a fresh day's new-word budget.
   */
  seededAt?: number;
  /**
   * Known-word declaration (C-5d): when the learner marks a word「もう覚えた（復習から外す）」it is
   * suspended — excluded from `isDueForReview` (so it leaves the /review queue and the home due
   * count), from `wordSuggestionService`'s re-weaving pool, and from reading-time recall seeding /
   * crediting (recallController). Absent/false ⇒ active. Non-indexed; restoring it (「復習に戻す」)
   * simply clears the flag. No Dexie migration/back-fill needed — legacy rows read as active.
   */
  suspended?: boolean;
}

/** Append-only review event (FSRS replay, loss recovery, double-count cooldown). */
export interface ReviewLogEntry {
  /** Dexie auto-increment key (assigned on append). */
  id?: number;
  userId: UserId;
  wordId: string;
  rating: Rating;
  /**
   * Origin of the event. `review` = explicit rating (Flow 2); `passage` = passive read-through /
   * lookup credit (Flow 3); `undo` = the offsetting audit entry appended when a rating is undone
   * (C-5c). The log stays append-only, so an undo never deletes the original `review` row — instead
   * it records a canceling `undo` row (carrying the undone rating) that nets the day's review tally
   * back down and preserves a full FSRS-replayable trail.
   */
  source: 'review' | 'passage' | 'undo';
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
  /**
   * The word target actually used to generate this passage when it differs from the requested one
   * (Requirement 7 / B-5): set when an adaptive retry retreated the target to a physically
   * achievable size after a `max_tokens` truncation. Absent ⇒ the requested target was used as-is.
   */
  effectiveWordTarget?: number;
  /**
   * Recorded when the passage shipped WITH a length shortfall (B-5 第2弾): the generate loop (or the
   * chunked long-form path) could not reach the requested word band, so it shipped a shorter-but-
   * readable passage as a last resort. `requested` is the learner's target; `actual` is the measured
   * word count of the shipped body. The reader surfaces a「指定 N 語 / 実際 M 語」banner (theme D).
   * Absent ⇒ the passage met the length band.
   */
  lengthShortfall?: { requested: number; actual: number };
  /**
   * Outcome of the exhaustive annotation pass (F-6). `complete` ⇒ the pass finished normally;
   * `partial` ⇒ some cues were salvaged from a truncated reply (Phase 3); `failed` ⇒ the pass was
   * refused/truncated/errored and produced no cues. Absent ⇒ no annotation pass was run (e.g. a
   * gateway without the enrichment). The reader surfaces a banner + regenerate button on
   * partial/failed so a silent annotation loss is visible and recoverable.
   */
  annotationStatus?: AnnotationStatus;
  /**
   * Measured CEFR vocabulary profile (B-4): the fraction of *known-band* tokens that sit ABOVE the
   * requested level (`offBandRatio`), and how many tokens carried a known band (`sampleSize`, the
   * profile's denominator). Recorded by the generation orchestrator from the accepting validation
   * report when a CEFR dictionary was injected AND matched ≥1 token; absent for gateways/tests
   * without the dictionary. Feeds the reader's「語彙実測」display (theme D) and the B-1〜B-3
   * acceptance measurements.
   */
  vocabProfile?: { offBandRatio: number; sampleSize: number };
  /**
   * Residual quality shortfalls the passage shipped WITH (B-1 / R4): when the generate→repair loop
   * exhausts its budget but the only remaining faults are quality-level (idiom/set-phrase quota
   * unmet, missing collocation coverage, etc.), the passage is still shipped — never hard-failed —
   * and the human-readable warnings are recorded here for the reader to surface (theme D). Absent ⇒
   * the passage passed validation cleanly.
   */
  qualityWarnings?: string[];
  /**
   * Generated scene illustration. Historically a base64 `data:` URL; after the images-table split
   * (F-5 第3段 / D7) newly stored illustrations are a `lexia-image:<imageId>` reference resolved via
   * `AssetImage`. Optional enrichment: absent when image generation is disabled, unconfigured,
   * pending, or failed.
   */
  sceneIllustrationUrl?: string;
  /**
   * Downscaled 192×128 thumbnail of the scene illustration (D-4 第2段), stored as a
   * `lexia-image:<imageId>` reference to a small JPEG blob in the images table (D7). Derived lazily
   * from `sceneIllustrationUrl` the first time the library lists this passage, then reused so the
   * 文章一覧 decodes tiny thumbnails instead of full-size illustrations. Absent ⇒ no illustration yet,
   * or the thumbnail has not been generated (the list falls back to `sceneIllustrationUrl`).
   */
  sceneThumbnailUrl?: string;
  /** Listening-scene metadata (absent for reading/story prose). */
  listeningScene?: {
    sceneKind: ListeningSceneKind;
    noiseLevel: AmbientNoiseLevel;
    accent: EnglishAccent;
    speakers: {
      speakerId: string;
      label: string;
      role: VoiceRole;
      voiceProfileId: string;
    }[];
  };
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
  /** Present for dialogue/listening scenes; used for speaker labels and multi-voice TTS. */
  speakerId?: string;
  /**
   * Optional translation-side emphasis spans (Requirement 4). Absent ⇒ no JA-side emphasis,
   * keeping passages generated before this feature valid.
   */
  translationSpans?: TranslationSpan[];
  /**
   * 0-based paragraph the sentence belongs to (F-8②): starts at 0 and increments by 1 at each
   * discourse break, so the reader can insert paragraph spacing. Absent on passages generated
   * before this feature ⇒ the whole passage renders as one paragraph (no migration needed).
   */
  paragraphIndex?: number;
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
  /**
   * Identifies which supplied collocation was woven in. Per design decision D4 this is matched
   * with an「id ⇄ 旧文字列」fallback: for structured word data it is the `CollocationEntry.id`
   * (kebab-case stable id), and for legacy plain-string collocations it is the collocation string
   * itself. The reanchor + validator treat both forms as equivalent so C-3 structuring needs no
   * prompt/validator rewrite.
   */
  collocationId: string;
  /**
   * The collocation as realized in the passage, copied verbatim by the model (the FULL phrase,
   * e.g. "accept the new proposal"). The server re-derives the span from it, so the in-text tint
   * covers the whole phrase instead of collapsing to the head word. Absent on legacy passages —
   * those re-anchor from the collocationId's head form (often a single token).
   */
  surface?: string;
}

/** Self-reported idiom / phrasal verb / set phrase category (B-1 / B-2). */
export type ExpressionCategory = 'idiom' | 'phrasal_verb' | 'set_phrase';

/**
 * A high-frequency idiom, phrasal verb, or set phrase the model deliberately wove into the passage
 * and self-reported (B-1 / B-2), mirroring the target/collocation self-report → re-anchor → validate
 * pipeline. `span` is RE-DERIVED server-side from `surface` (the model miscounts token indices), so
 * the in-text highlight always matches the reported expression. Validated: expression spans below
 * the requested quota surface as `qualityWarnings`, never a hard failure.
 */
export interface ExpressionSpan {
  span: SpanRef;
  /** The tokens joined, verbatim — the expression's surface form in the passage. */
  surface: string;
  category: ExpressionCategory;
  /** Short natural Japanese gloss shown in the reading UI. */
  meaningJa: string;
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
  /**
   * 本文中での意味: what the expression means AT THIS SPOT in the passage (one short Japanese
   * gloss). Shown FIRST in the study guide — before the usage insight — because the learner's
   * primary question is "この文の中でどういう意味か". Absent on legacy cues (pre-feature passages);
   * the UI then falls back to leading with `explanationJa`.
   */
  meaningJa?: string;
  explanationJa: string;
  /**
   * Optional deeper explanation revealed only when the learner expands the cue (C-1 annotation side).
   * For idiom / metaphor cues it bridges the literal image → metaphorical shift → current meaning;
   * for grammar_pattern / sentence_structure cues it explains how to parse the sentence. Absent ⇒ no
   * expandable detail (the compact `explanationJa` stays the whole cue). Kept short (≤~120 chars) so
   * the rail's initial compact-card height is unchanged (D-1 layout invariant).
   */
  detailJa?: string;
  /**
   * Extra token ranges for a DISCONTINUOUS expression (C-4), e.g. the「than」half of
   * "no sooner ... than" or the「but also」half of "not only ... but also". `anchorText`/`span` cover
   * the FIRST contiguous part; each additional part the model reported (`anchorTextParts`) that the
   * server could re-anchor is added here. The reader lights every part with the ONE badge/cue so a
   * split construction reads as a single unit. Absent ⇒ the expression is contiguous (`span` is whole).
   */
  extraSpans?: SpanRef[];
}

/**
 * Difficult syntactic construction the model was asked to place at a given readability level (B-3).
 * The named values are the exam-frequent advanced constructions the `advanced` band must contain;
 * `other` covers any deliberate construction outside that list.
 */
export type SyntaxPattern =
  | 'nonrestrictive_relative'
  | 'participial'
  | 'inversion'
  | 'cleft'
  | 'subjunctive'
  | 'appositive'
  | 'other';

/**
 * A self-reported difficult syntactic construction the model deliberately used (B-3). Mirrors the
 * expressionSpans self-report, but keyed by `sentenceIndex` + a verbatim `anchorText` snippet rather
 * than a token span (a construction may be discontinuous). The validator checks that `anchorText`
 * occurs verbatim in that sentence and — at `advanced` readability — that the passage covers enough
 * distinct constructions. `noteJa` is a short Japanese reading hint that seeds the C-4
 * syntax-explanation UI. Absent on passages generated before this feature ⇒ no syntax notes
 * (back-compat, no migration).
 */
export interface SyntaxSpan {
  /** Index of the sentence the construction occurs in. */
  sentenceIndex: number;
  pattern: SyntaxPattern;
  /** A verbatim snippet of that sentence containing the construction. */
  anchorText: string;
  /** One short Japanese reading hint (e.g. "倒置: Not only が文頭に出て助動詞 did が主語の前に移動する"). */
  noteJa: string;
}

/**
 * One labelled meaning chunk of a hard sentence (C-4). `[tokenStart, tokenEnd)` is a half-open token
 * range within that sentence and `roleJa` names its grammatical role (主語 / 述語動詞 / 従属節（譲歩）/
 * 挿入句 など) so the reader can underline each clause with its role.
 */
export interface SentenceChunk {
  tokenStart: number;
  tokenEnd: number;
  roleJa: string;
}

/**
 * A sentence-level syntax explanation produced by the annotation pass (C-4): for a sentence a CEFR
 * reader would find hard to parse (long subordination, inversion, participial / cleft constructions,
 * nested relatives, heavy noun phrases), it gives the construction's Japanese label, how the sentence
 * is built + why it is easy to misread, the natural decoding order as an arrow chain, and the labelled
 * meaning chunks. Rendered as an expandable「構文」panel under the sentence. Absent on passages
 * generated/annotated before this feature ⇒ no syntax notes (back-compat, no migration).
 */
export interface SentenceSyntaxNote {
  sentenceIndex: number;
  /** Short Japanese label of the construction (e.g. 「倒置（否定副詞句＋助動詞前置）」). */
  patternNameJa: string;
  /** 1-3 Japanese sentences: where the main subject/verb are, what each clause does, why it misreads. */
  structureJa: string;
  /** The natural decoding order as an arrow chain over meaning chunks (English chunk → Japanese sense). */
  readingJa: string;
  chunks: SentenceChunk[];
}

export interface PassageOutput {
  meta: PassageMeta;
  sentences: Sentence[];
  targetSpans: TargetSpan[];
  collocationSpans: CollocationSpan[];
  noticeCues: NoticeCue[];
  /**
   * Self-reported idioms / phrasal verbs / set phrases woven into the passage (B-1 / B-2). Absent on
   * passages generated before this feature ⇒ no expression highlights (back-compat, no migration).
   */
  expressionSpans?: ExpressionSpan[];
  /**
   * Self-reported difficult syntactic constructions the model deliberately used (B-3), seeding the
   * C-4 syntax-explanation UI. Absent on passages generated before this feature ⇒ no syntax notes
   * (back-compat, no migration).
   */
  syntaxSpans?: SyntaxSpan[];
  /**
   * Sentence-level syntax explanations for hard sentences (C-4), produced by the annotation pass and
   * attached by the generation orchestrator. Absent on passages generated/annotated before this
   * feature ⇒ no「構文」panels (back-compat, no migration).
   */
  syntaxNotes?: SentenceSyntaxNote[];
}

// ── Story scaffold (Requirement 6) ───────────────────────────────────────────

/** A character in a generated story plan. */
export interface StoryCharacter {
  name: string;
  role: string;
  descriptionJa: string;
  /**
   * Generated portrait as a base64 `data:` URL (Requirement 6.8). Kept as the primary/back-compat
   * field for existing stored plans and overview pages.
   */
  illustrationUrl?: string;
  /** Explicit portrait image for character overviews. Falls back to `illustrationUrl` for old plans. */
  portraitIllustrationUrl?: string;
  /** Full-body character image for the individual character detail page. */
  fullBodyIllustrationUrl?: string;
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
  contentType: StoryContentType;
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
  contentType: StoryContentType;
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

/** Request for a single character illustration variant (Requirement 6.8). */
export interface CharacterIllustrationRequest {
  name: string;
  role: string;
  descriptionJa: string;
  genre: StoryGenre;
  /** `portrait` for story overviews; `full_body` for the character detail page. */
  variant?: 'portrait' | 'full_body';
  /** Story-level identity context, used to keep portrait and full-body variants consistent. */
  storyTitleJa?: string;
  storySynopsisJa?: string;
  /** Stable cast style/identity guide shared by all character image requests for the story. */
  castStyleGuide?: string;
  /** Style/motif hint (from the plan's homage note or genre) to keep the cast visually coherent. */
  styleHint?: string;
  /**
   * Optional per-request quality/speed profile override (E-1). Absent ⇒ the endpoint's use-based
   * default (character art = `fast`). Set only when the learner pins a global preference.
   */
  imagePreference?: 'fast' | 'quality';
}

/** Request for an illustration that represents the generated passage's main scene. */
export interface PassageIllustrationRequest {
  title: string;
  intent: LearningIntent;
  level: Cefr;
  sentences: Sentence[];
  story?: {
    genre: StoryGenre;
    titleJa: string;
    synopsisJa: string;
    chapterHeadingJa?: string;
    chapterBeatJa?: string;
    characters: Pick<StoryCharacter, 'name' | 'role' | 'descriptionJa'>[];
    /** Style/motif hint (from the plan's homage note or genre), never a license to copy text. */
    styleHint?: string;
  };
  /**
   * Optional per-request quality/speed profile override (E-1). Absent ⇒ the endpoint's use-based
   * default (scene art = `quality`). Set only when the learner pins a global preference.
   */
  imagePreference?: 'fast' | 'quality';
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
  format: 'audio/mpeg' | 'audio/aac' | 'audio/wav';
  durationMs: number;
  engine: 'polly' | 'azure' | 'openai';
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

/**
 * A structured collocation for a headword (C-3). Replaces the legacy bare `string`. `id` is a stable
 * kebab-case key that `CollocationSpan.collocationId` references (design decision D4: matched with an
 * id ⇄ 旧文字列 fallback, so passages generated before structuring still resolve). `pattern` shows the
 * head plus a slot in fullwidth angle brackets naming the filler's semantic category in Japanese
 * (e.g. "accept ＜提案・招待＞", "＜経済が＞ recover").
 */
export interface CollocationEntry {
  /** Stable kebab-case id (e.g. "accept-proposal"); referenced by CollocationSpan.collocationId. */
  id: string;
  /** Head + slot notation (e.g. "accept ＜提案・招待＞", "＜経済が＞ recover"). */
  pattern: string;
  type: 'V+N' | 'Adj+N' | 'N+of+N' | 'V+Prep' | 'Adv+V' | 'other';
  /** 2-4 real high-frequency English fillers for the slot (e.g. ["offer","invitation","proposal"]). */
  slotExamples: string[];
  glossJa: string;
  exampleEn?: string;
  /** true when the natural Japanese rendering diverges from the literal word-for-word translation. */
  l1Contrast: boolean;
}

/**
 * A common fixed expression containing the headword (C-1). `originJa` bridges the literal image to the
 * idiomatic meaning (literal reading → metaphorical shift → current meaning), hedged when the origin
 * is uncertain — never a confident false etymology.
 */
export interface IdiomEntry {
  /** The expression itself (e.g. "break the ice"). */
  expression: string;
  /** Current idiomatic meaning in Japanese. */
  meaningJa: string;
  /** 字義 → 比喩の橋渡し → 現在の意味. Hedged with 「〜と言われる」 when uncertain. */
  originJa: string;
  exampleEn?: string;
  exampleJa?: string;
}

/** One morpheme of a headword's decomposition (C-2). */
export interface EtymologyPart {
  /** The morpheme as written (e.g. "re-", "sili", "-ent"). */
  form: string;
  /** The exact substring of the headword this part maps to, or null when sound change obscured it. */
  surfaceIn: string | null;
  /** The Japanese meaning of this part (e.g. "再び"). */
  meaningJa: string;
}

/** Structured word etymology (C-2). Replaces the legacy `{ prefix?; root?; suffix?; noteJa? }`. */
export interface EtymologyV2 {
  parts: EtymologyPart[];
  /** The parts composed into the modern sense as one arrow chain (required). */
  bridgeJa: string;
  /** 2-5 words sharing the root, each linked to it. */
  cognates: { word: string; noteJa: string }[];
  /** Source language/form (e.g. "ラテン語 salire「跳ぶ」"). */
  sourceJa?: string;
}

export type SemanticRelation = 'synonym' | 'antonym' | 'hypernym' | 'hyponym' | 'related';

/**
 * One neighbor in a word's semantic network (C-2). Replaces the legacy five parallel string arrays;
 * a flat, annotated, tappable list that also carries hypernyms/hyponyms/related (previously generated
 * but never shown).
 */
export interface SemanticNeighbor {
  word: string;
  relation: SemanticRelation;
  /** How the word relates to / differs from the headword (≤25 Japanese chars, e.g. "buy より硬め"). */
  noteJa: string;
}

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
    collocations: CollocationEntry[];
    synonymNuances: string[];
  };
  more?: Partial<{
    etymology: EtymologyV2;
    semanticNetwork: SemanticNeighbor[];
    wordFamily: string[];
    idioms: IdiomEntry[];
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
  /**
   * Last time the learner actually opened this passage into the reader (F-2). Drives the
   * "続きを読む" ordering — newest-opened first — so the CONTINUE card follows real reading
   * activity rather than the fixed generation/first-start time. Legacy rows are back-filled
   * with `startedAt` on migration.
   */
  lastOpenedAt: number;
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
  /**
   * Manually added words only (A-1-1). Auto-selected words are resolved at generation time from
   * the level/intent/SRS state and are NOT stored here, so they never survive a reset or re-visit.
   */
  /** Scene format/accent for generated listening practice. */
  listeningOptions?: ListeningOptions;
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
  /**
   * Per-day review-card ceiling (C-5c). Absent ⇒ the policy default `DAILY_REVIEW_LIMIT` (60).
   * Settable to 20–200; the review session caps its size at `min(SESSION_REVIEW_LIMIT, this − 当日評定数)`.
   */
  dailyReviewLimit?: number;
  /**
   * How a generation run delivers its pieces. `staged` (default): the passage opens as soon as the
   * body validates; annotation (学習ガイドの気づき), audio and illustration then stream in as each
   * finishes. `batch`: the pre-existing behavior — the reader opens only after the annotation pass
   * also completed, so everything textual is present on first paint.
   */
  generationMode?: 'staged' | 'batch';
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
  /**
   * Sub-band position WITHIN the CEFR band plus the learner's concrete exam goal (A-3-1). The CEFR
   * pivot stays coarse (`level`); this only nudges the prompt so a "TOEIC 900" (B2 `high`) passage
   * reads clearly harder than a plain B2 one, without touching suggest/validation/SRS. Absent ⇒ no
   * sub-band calibration (back-compat).
   */
  levelDetail?: { subBand: LevelSubBand; examLabel: string };
  targetWords: GenerationTargetWord[];
  /** Story-chapter consistency context (Requirement 6.6). Unset for standalone articles. */
  storyContext?: StoryContext;
  /** Listening-scene format/accent, set only when contentType is `listening_scene`. */
  listeningOptions?: ListeningOptions;
  /**
   * Continuation context for chunked generation of a long passage (B-5 第2弾). When a word target
   * exceeds the single-request ceiling the orchestrator splits it into sequential segments and
   * passes each segment its position plus a Japanese summary of what came before, so the segments
   * read as one continuous piece rather than N restarts — the same priorSummaryJa mechanism stories
   * use, reused for non-story long form. Absent on single-shot generation (the common case).
   */
  continuationContext?: {
    /** 0-based index of this segment within the split. */
    segmentIndex: number;
    /** Total number of segments the passage is split into. */
    segmentCount: number;
    /** Japanese summary of the passage so far (the tail of prior segments); empty for segment 0. */
    priorSummaryJa: string;
  };
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
  /**
   * Readability band the passage was generated at (C-4). When `advanced`, the annotation pass MUST
   * emit a syntax note for every hard sentence; at easier bands syntax notes are optional. Absent ⇒
   * the pass infers the band from `level` (older gateways/tests omit it).
   */
  readabilityLevel?: ReadabilityLevel;
  /**
   * Sentence indices the generation pass deliberately made hard to parse (C-4), derived from the
   * self-reported `syntaxSpans` (B-3). The annotation pass is told to cover each with a syntax note.
   * Absent/empty ⇒ the model decides which sentences are hard on its own.
   */
  hardSentenceIndexes?: number[];
  targetSpans?: TargetSpan[];
  collocationSpans?: CollocationSpan[];
  /** Self-reported idioms/phrasal verbs/set phrases (B-1/B-2), added to REQUIRED COVERAGE so every
   * woven-in expression is guaranteed a「気づき」cue. */
  expressionSpans?: ExpressionSpan[];
  /** Set only when this request annotates a CONTIGUOUS SLICE of a longer passage (F-6 本命 chunked
   * annotation). Its value is the absolute sentence index of `sentences[0]` within the full passage;
   * spans keep their absolute `sentenceIndex`, sentences are numbered from this base, and the model is
   * told to copy the absolute indices verbatim. Undefined ⇒ the request covers the whole passage. */
  sentenceIndexBase?: number;
}

/**
 * Outcome of the annotation pass (F-6). `complete` = the model finished; `partial` = cues were
 * salvaged from a truncated reply (Phase 3 partial-recovery); `failed` = refusal/truncation/error
 * produced no cues. Recorded on `PassageMeta.annotationStatus` so the reader can surface a
 * banner + regenerate button instead of silently shipping a passage with no「気づき」.
 */
/** `pending` = the staged pipeline deferred the annotation pass; it is being generated in the
 * background (or awaits a backfill after a reload) and merges into the passage when it lands. */
export type AnnotationStatus = 'complete' | 'partial' | 'failed' | 'pending';

/** Result of the annotation pass: the grounded cues plus the outcome status (F-6). */
export interface AnnotationResult {
  noticeCues: NoticeCue[];
  status: AnnotationStatus;
  /**
   * Sentence-level syntax explanations for hard sentences (C-4). Absent ⇒ the pass produced none (e.g.
   * an easy passage or a gateway/mock without the enrichment). Merged onto `PassageOutput.syntaxNotes`.
   */
  sentenceNotes?: SentenceSyntaxNote[];
}

/**
 * Asks the proxy for ONE fresh review-context sentence for a word (C-5c review material). Used as
 * the third fallback in the review-material priority chain — after a different sentence from a past
 * passage and after the word's own cached example sentences, but before the bare-headword last
 * resort. The prompt is deliberately lightweight (a single CEFR-appropriate sentence that naturally
 * uses the headword). Failure is non-fatal: the caller drops to the next material tier.
 */
export interface ReviewSentenceRequest {
  wordId: string;
  headword: string;
  /** Target CEFR band so the sentence stays at the learner's level. */
  level: Cefr;
  /** Primary JA gloss, to disambiguate the intended sense. */
  meaningJa?: string;
  /** A few known collocations to steer natural usage. */
  collocations?: string[];
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
  /**
   * Learner's local offset from UTC in minutes (east of UTC positive, JST = +540;
   * `-new Date().getTimezoneOffset()`). Sets the local-midnight boundary for the daily new-word cap
   * so it resets in step with the dashboard's local day (F-4). Defaults to 0 (UTC) when omitted.
   */
  tzOffsetMinutes?: number;
  /** Words the learner already excluded (lowercase lemma). */
  excludedWordIds: string[];
  /** How many candidates to present. */
  count: number;
  /**
   * @deprecated Kept for one release; superseded by `plan`. Legacy TOTAL candidate cap derived from
   * wordTarget × newWordRatio (review-first, then new). Ignored when `plan` is present.
   */
  desiredNewCount?: number;
  /**
   * Review/new slot split for the woven-in words (A-1-3). `reviewSlots` are filled from due / weak
   * scheduled vocabulary; `newSlots` from fresh LLM proposals. A shortfall in one slot spills into
   * the other, so a passage is never candidate-empty even at a 0% or 100% new-word ratio.
   */
  plan?: { reviewSlots: number; newSlots: number };
  /**
   * Force a fresh suggestion-LLM fetch, bypassing the cached proposal pool (E-3(c)). Used by an
   * explicit「候補を更新」action; absent/false serves cache-first within the TTL.
   */
  refresh?: boolean;
}

export interface SuggestionResult {
  /** ABC-ordered, deduped candidates with introduced/excluded words removed. */
  candidates: CandidateWord[];
  /** Present when fewer than `count` candidates were available (Requirement 5.5). */
  shortfall?: { requested: number; available: number; reason: 'exhausted' | 'gateway_unavailable' };
  /**
   * Daily new-word cap outcome (C-5b): present only when the `DAILY_NEW_WORD_LIMIT` clamp reduced
   * the new-word slots the newWordRatio asked for. `remaining` is how many genuinely-new words may
   * still be introduced today (0 ⇒ the cap is exhausted, so this generation weaves review words
   * only). The clamp always wins over the slider; review slots are unaffected.
   */
  newWordClamp?: { remaining: number };
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

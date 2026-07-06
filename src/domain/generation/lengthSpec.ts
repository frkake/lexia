/**
 * Single source of truth for the numeric word-count spec (Requirement 7), shared by the server
 * prompt (`server/llm/schema.ts`) and the client-side length gate (`passageValidator.ts`) so they
 * cannot drift apart. Type-only dependency, so importing this into the server proxy pulls no
 * runtime domain code.
 *
 * Replaces the legacy 3-value `length` constants: `wordTarget` (a multiple of 100) is the primary
 * input, and content-type ranges / page conversion / token budget / woven-in new-word count are all
 * derived from it. `migrateLegacyLength` seeds the slider from old settings (one-time migration).
 */

import type { ContentType } from '../../types/domain';

/** Words per book page (6×9 paperback standard; research.md). */
export const WORDS_PER_PAGE = 275;

/**
 * Acceptance band for the validator's length gate, as a fraction of the requested word target: the
 * body must land within `[1 − t, 1 + t] × target`. Restored to 0.25 (band 0.75×–1.25×) now that the
 * generation basis is sound (B-5): an upper-generation default model, a right-sized token budget, and
 * — critically — chunked generation for targets above the single-request ceiling, so a large target
 * no longer truncates into a stub. The old loose 0.6 floor (0.4×target) was a stopgap for a model
 * that systematically under-produced; the prompt still aims for ±20%. When the body still misses the
 * band the passage is shipped as a `length_out_of_range` residual with `meta.lengthShortfall`
 * recorded, never hard-failed.
 */
export const LENGTH_WORD_TOLERANCE = 0.25;

/** Content-type word-count ranges (Requirement 7.3). Long stories bound a single chapter. */
const WORD_RANGES: Record<ContentType, { min: number; max: number; step: 100 }> = {
  article: { min: 100, max: 1500, step: 100 },
  short_story: { min: 500, max: 3000, step: 100 },
  long_story: { min: 800, max: 2500, step: 100 },
  listening_scene: { min: 100, max: 1200, step: 100 },
};

/**
 * How the woven-in target words split between a *review* slot (due / weak vocabulary that should
 * reappear) and a *new* slot (fresh LLM-proposed vocabulary), derived from the passage length and
 * the learner's new-word ratio (A-1-3). `newWordRatio` is now literally "the fraction of the target
 * words that are new" — 0 ⇒ all review, 1 ⇒ all new — while `total` stays ≥ 1 even at ratio 0 so a
 * passage always has at least one word to weave in (the old ratio-0 ⇒ zero-candidates bug).
 */
export interface TargetWordPlan {
  /** Total words to weave in: `min(12, max(1, round(wordTarget / 40)))`. */
  total: number;
  /** New (LLM-proposed) slots: `round(total * newWordRatio)`. */
  newSlots: number;
  /** Review (due / weak) slots: `total - newSlots`. */
  reviewSlots: number;
}

export interface LengthSpec {
  /** Content-type word-count min/max with a 100-word step (Requirement 7.3). */
  wordRange(contentType: ContentType): { min: number; max: number; step: 100 };
  /** Word count → approximate book pages at WORDS_PER_PAGE (Requirement 7.2). */
  pagesFor(wordTarget: number): number;
  /** Word count → generation token budget (continuous replacement for maxTokensForLength). */
  tokenBudgetFor(wordTarget: number): number;
  /** Word count + new-word ratio → number of new words to weave in (continuous NEW_WORDS_BY_LENGTH). */
  newWordsFor(wordTarget: number, newWordRatio: number): number;
  /** Word count + new-word ratio → the review/new slot split for the target words (A-1-3). */
  targetWordPlanFor(wordTarget: number, newWordRatio: number): TargetWordPlan;
  /** Legacy 'short'|'medium'|'long' → seed wordTarget (one-time settings migration). */
  migrateLegacyLength(legacy: 'short' | 'medium' | 'long'): number;
}

function wordRange(contentType: ContentType): { min: number; max: number; step: 100 } {
  return WORD_RANGES[contentType];
}

function pagesFor(wordTarget: number): number {
  return Math.max(1, Math.round(wordTarget / WORDS_PER_PAGE));
}

/**
 * Output-token ceiling (gpt-4o / most chat models cap completions at 16384). The budget is clamped
 * below this so very large word targets still issue a valid request.
 */
const MAX_OUTPUT_TOKENS = 16000;

/**
 * Token budget grows with the word count. A `PassageOutput` is far denser than its English word
 * count: each word is its own quoted JSON array element (~2.7 output tokens), every sentence also
 * carries a Japanese `translationJa` (~2 tokens/word — Japanese is token-dense) plus target and
 * translation spans and the JSON envelope. Undersizing this starves the model into truncating or
 * under-producing, which then fails the (non-salvageable) length gate and surfaces as
 * `validation_exhausted`. So we allot ~9 output tokens per word plus a fixed overhead, matching the
 * old `maxTokensForLength` ratio (long = 3600 tokens for ~400 words). Monotonic; clamped to the
 * provider ceiling.
 *
 * The fixed overhead was raised 1000→1200 (B-1/F-8②, risk R5) to cover the extra output the batch-1
 * schema asks for on every passage: per-sentence `paragraphIndex`, the self-reported `expressionSpans`
 * array (idioms / phrasal verbs / set phrases), and the echoed `levelDetail`. Batch-2 (B-3, risk R5)
 * raised it again 1200→1400 for the self-reported `syntaxSpans` array (bounded — only `advanced`
 * passages emit a handful of entries, each a short anchorText + noteJa). The 1600-word single-request
 * ceiling still leaves headroom: floor((16000-1400)/9) ≈ 1622 > 1600.
 *
 * Re-estimation for chunked generation (B-5 第2弾, risk R5): a target above the 1600 ceiling is no
 * longer requested in one shot — the orchestrator splits it into segments of ≤ ~1200 words, each
 * issued as its own request. So `tokenBudgetFor` is only ever evaluated at the PER-SEGMENT target: a
 * 1200-word segment budgets 1200 + 1200·9 = 12000 tokens (~10/word), comfortably clear of the 16000
 * ceiling even with the batch-1 extras, so no segment truncates. The clamp only ever binds on legacy
 * single-shot requests that ask for more than the ceiling, which no longer happens.
 */
function tokenBudgetFor(wordTarget: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.round(1400 + wordTarget * 9));
}

/**
 * Idiom / phrasal-verb quota for a passage of `approxWords` (B-1): at least ~1 per 150 running words,
 * floored at 2 so even the shortest passage carries some idiomatic language. Shared by the server
 * prompt and the client-side quality gate so they cannot drift.
 */
export function idiomQuotaFor(approxWords: number): number {
  return Math.max(2, Math.round(approxWords / 150));
}

/**
 * Set-phrase / formulaic-language quota for a passage of `approxWords` (B-2): at least ~1 per 200
 * running words, floored at 2. Shared by the server prompt and the client-side quality gate.
 */
export function setPhraseQuotaFor(approxWords: number): number {
  return Math.max(2, Math.round(approxWords / 200));
}

/** New words to weave in: proportional to length, but never fewer than 1 when the ratio is positive. */
function newWordsFor(wordTarget: number, newWordRatio: number): number {
  if (newWordRatio <= 0) return 0;
  // ~1 new word per 40 running words at ratio 0.3, scaled linearly by the ratio.
  const raw = Math.round((wordTarget / 40) * (newWordRatio / 0.3));
  return Math.max(1, raw);
}

/** Upper bound on words woven into a single passage (matches the setup candidate cap). */
const MAX_TARGET_WORDS = 12;

/**
 * Split the target words into review / new slots (A-1-3). `total` is ~1 word per 40 running words,
 * clamped to `[1, 12]` so even a ratio-0 (review-only) passage still weaves in at least one word.
 * `newSlots` is the ratio-share of `total`; the remainder are review slots. The suggestion service
 * fills each slot independently and spills a shortfall from one into the other.
 */
function targetWordPlanFor(wordTarget: number, newWordRatio: number): TargetWordPlan {
  const total = Math.min(MAX_TARGET_WORDS, Math.max(1, Math.round(wordTarget / 40)));
  const ratio = Math.min(1, Math.max(0, newWordRatio));
  const newSlots = Math.round(total * ratio);
  return { total, newSlots, reviewSlots: total - newSlots };
}

const LEGACY_LENGTH_WORDS: Record<'short' | 'medium' | 'long', number> = {
  short: 200,
  medium: 400,
  long: 800,
};

function migrateLegacyLength(legacy: 'short' | 'medium' | 'long'): number {
  return LEGACY_LENGTH_WORDS[legacy];
}

export const lengthSpec: LengthSpec = {
  wordRange,
  pagesFor,
  tokenBudgetFor,
  newWordsFor,
  targetWordPlanFor,
  migrateLegacyLength,
};

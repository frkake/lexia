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
 * Acceptance band for the validator's length gate, as a fraction of the requested word target.
 * Deliberately loose — it only rejects gross deviation (e.g. 250 requested, 40 returned). gpt-4o
 * systematically under-produces, so the floor sits at 0.4×target; the prompt still aims for ±20%.
 */
export const LENGTH_WORD_TOLERANCE = 0.6;

/** Content-type word-count ranges (Requirement 7.3). Long stories bound a single chapter. */
const WORD_RANGES: Record<ContentType, { min: number; max: number; step: 100 }> = {
  article: { min: 100, max: 1500, step: 100 },
  short_story: { min: 500, max: 3000, step: 100 },
  long_story: { min: 800, max: 2500, step: 100 },
};

export interface LengthSpec {
  /** Content-type word-count min/max with a 100-word step (Requirement 7.3). */
  wordRange(contentType: ContentType): { min: number; max: number; step: 100 };
  /** Word count → approximate book pages at WORDS_PER_PAGE (Requirement 7.2). */
  pagesFor(wordTarget: number): number;
  /** Word count → generation token budget (continuous replacement for maxTokensForLength). */
  tokenBudgetFor(wordTarget: number): number;
  /** Word count + new-word ratio → number of new words to weave in (continuous NEW_WORDS_BY_LENGTH). */
  newWordsFor(wordTarget: number, newWordRatio: number): number;
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
 */
function tokenBudgetFor(wordTarget: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.round(1000 + wordTarget * 9));
}

/** New words to weave in: proportional to length, but never fewer than 1 when the ratio is positive. */
function newWordsFor(wordTarget: number, newWordRatio: number): number {
  if (newWordRatio <= 0) return 0;
  // ~1 new word per 40 running words at ratio 0.3, scaled linearly by the ratio.
  const raw = Math.round((wordTarget / 40) * (newWordRatio / 0.3));
  return Math.max(1, raw);
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
  migrateLegacyLength,
};

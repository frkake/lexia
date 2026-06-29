/**
 * Single source of truth for the requested-length → word-count target, shared by the
 * server prompt (`server/llm/schema.ts`) and the client-side length gate
 * (`passageValidator.ts`) so they cannot drift apart. Type-only dependency, so importing
 * this into the server proxy pulls no runtime domain code.
 */

import type { GenerationRequest } from '../../types/domain';

/** Approximate word target per requested length (mirrors the Setup screen labels). */
export const APPROX_WORDS: Record<GenerationRequest['length'], number> = {
  short: 120,
  medium: 250,
  long: 400,
};

/**
 * Acceptance band for the validator's length gate, as a fraction of `approxWords`.
 * Deliberately loose — it only rejects gross deviation (e.g. 250 requested, 40 returned).
 * gpt-4o systematically under-produces, so the floor sits at 0.4×approxWords to avoid failing
 * generation over normal shortfall; the prompt still aims for the tighter ±20%.
 */
export const LENGTH_WORD_TOLERANCE = 0.6;

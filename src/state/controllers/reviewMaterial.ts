/**
 * L3 — reviewMaterial: resolves the "new context" sentence a review card shows for a word, in the
 * policy-mandated priority order (C-5c, learning-policy.md 復習例文 row — encoding variety, principle
 * 4). No fabricated dummy sentence anywhere in the chain:
 *   1. a DIFFERENT sentence from one of the learner's past passages (real, varied context),
 *   2. else one of the word's own cached example sentences (rotated so it varies across reviews),
 *   3. else a single fresh sentence from the LLM proxy (lightweight prompt; non-fatal on failure),
 *   4. else the bare headword with no surrounding context (last resort).
 * Steps 1–2 are pure/synchronous; step 3 is an optional injected async call so tests need no server.
 */

import { tokenizer } from '../../domain/tokenizer/joinService';
import type { Cefr, ReviewSentenceRequest, WordData } from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

export type ReviewMaterialSource = 'passage' | 'example' | 'llm' | 'headword';

export interface ReviewContext {
  before: string;
  target: string;
  after: string;
}

export interface ReviewMaterial {
  context: ReviewContext;
  source: ReviewMaterialSource;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive whole-word split of `sentence` around the first occurrence of `target`, or null. */
export function splitAround(sentence: string, target: string): ReviewContext | null {
  const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
  const m = re.exec(sentence);
  if (!m) return null;
  return {
    before: sentence.slice(0, m.index),
    target: sentence.slice(m.index, m.index + m[0].length),
    after: sentence.slice(m.index + m[0].length),
  };
}

/** Render every stored-passage sentence to text once (the corpus scanned for tier-1 material). */
export function renderPassageCorpus(passages: readonly PassageRecord[]): string[] {
  const out: string[] = [];
  for (const rec of passages) {
    for (const sentence of rec.passage.sentences) out.push(tokenizer.renderText(sentence));
  }
  return out;
}

export interface ReviewMaterialDeps {
  /** Rendered sentences from the learner's stored passages (see `renderPassageCorpus`). */
  corpus: readonly string[];
  /** Optional single-sentence generator (server proxy). Skipped when absent or when it rejects. */
  reviewSentence?(req: ReviewSentenceRequest): Promise<string>;
}

/**
 * Resolve the review context for one word. `rotation` (e.g. the word's `reps`) rotates the choice so
 * a learner doesn't see the same sentence every time. `word` may be undefined when its WordData
 * failed to load — the chain then skips straight to tiers 1 and 4 (the corpus + the bare headword).
 */
export async function resolveReviewMaterial(
  deps: ReviewMaterialDeps,
  word: WordData | undefined,
  headword: string,
  level: Cefr,
  rotation: number,
): Promise<ReviewMaterial> {
  const spin = Number.isFinite(rotation) ? Math.abs(Math.trunc(rotation)) : 0;

  // 1) A different sentence from a past passage.
  const passageHits: ReviewContext[] = [];
  const reHead = new RegExp(`\\b${escapeRegExp(headword)}\\b`, 'i');
  for (const text of deps.corpus) {
    if (!reHead.test(text)) continue;
    const ctx = splitAround(text, headword);
    if (ctx) passageHits.push(ctx);
  }
  if (passageHits.length > 0) {
    return { context: passageHits[spin % passageHits.length]!, source: 'passage' };
  }

  // 2) Rotate the word's own cached examples.
  const exampleCtxs: ReviewContext[] = [];
  for (const ex of word?.core.examples ?? []) {
    const ctx = splitAround(ex.en, headword);
    if (ctx) exampleCtxs.push(ctx);
  }
  if (exampleCtxs.length > 0) {
    return { context: exampleCtxs[spin % exampleCtxs.length]!, source: 'example' };
  }

  // 3) One fresh sentence from the proxy (non-fatal).
  if (deps.reviewSentence && word) {
    try {
      const sentence = await deps.reviewSentence({
        wordId: word.wordId,
        headword,
        level,
        meaningJa: word.core.meaningsJa[0],
        collocations: word.core.collocations.slice(0, 3).map((col) => col.pattern),
      });
      const ctx = splitAround(sentence, headword);
      if (ctx) return { context: ctx, source: 'llm' };
    } catch {
      /* fall through to the bare-headword last resort */
    }
  }

  // 4) Bare headword — no invented sentence.
  return { context: { before: '', target: headword, after: '' }, source: 'headword' };
}

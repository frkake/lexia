/**
 * L1 — PassageValidator: checks a generated PassageOutput before it is accepted
 * (design.md "GenerationOrchestrator / PassageValidator"). The structured-output
 * schema only guarantees *shape*; this validator is load-bearing for meaning:
 *   - every span sits inside its sentence (`0 ≤ tokenStart < tokenEnd ≤ len`);
 *   - each TargetSpan's surface is the declared tokens AND an inflection of the
 *     target word;
 *   - each NoticeCue's `sourceAttribute` exists in the supplied attributes and is
 *     consistent with the cue's category;
 *   - the CEFR vocabulary profile (out-of-band ratio) stays within tolerance.
 * Pure: validates the candidate against an injected context, mutating nothing.
 */

import { tokenizer } from '../tokenizer/joinService';
import { CEFR_OUT_OF_BAND_TOLERANCE } from '../srs/parameters';
import { LENGTH_WORD_TOLERANCE } from './lengthSpec';
import { CATEGORY_ATTRIBUTES, isCueGrounded } from './noticeGrounding';
import type { Cefr, PassageOutput, Sentence, SpanRef } from '../../types/domain';

export type SpanViolationKind =
  | 'span_out_of_range'
  | 'surface_mismatch'
  | 'cue_unattested'
  | 'cue_category_mismatch'
  | 'cue_surface_mismatch'
  | 'cefr_out_of_band'
  | 'length_out_of_range';

export interface SpanViolation {
  kind: SpanViolationKind;
  detail: string;
  /**
   * Set when the violation belongs to a single NoticeCue (by its `index`). The orchestrator
   * uses this to drop just the offending cue(s) as a last resort, rather than failing the whole
   * passage over a cue-local marker drift. Absent for passage-wide checks (length, CEFR) and for
   * target/collocation span errors, which are not droppable.
   */
  cueIndex?: number;
}

export interface ValidationTarget {
  wordId: string;
  /** Base/lemma surface used to judge inflection. */
  surface: string;
  /** Optional explicit inflected forms (preferred over the morphological fallback). */
  inflections?: string[];
  /** Supplied vocabulary attributes (e.g. the WordData object) for cue grounding. */
  attributes?: Record<string, unknown>;
}

export interface ValidationContext {
  level: Cefr;
  targets: ValidationTarget[];
  /** Target word count for the requested length; the length gate runs only when present. */
  approxWords?: number;
  /** External CEFR band lookup for a lowercased token; undefined ⇒ unknown band. */
  cefrOf?: (token: string) => Cefr | undefined;
}

export interface ValidationReport {
  ok: boolean;
  violations: SpanViolation[];
  cefrOffBandRatio: number;
}

export interface PassageValidator {
  validate(candidate: PassageOutput, ctx: ValidationContext): ValidationReport;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CEFR_RANK: Record<Cefr, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };

const SUFFIXES = ['ing', 'edly', 'ied', 'ies', 'es', 'ed', 'er', 'est', 'ly', "'s", 's', 'd', 'n'];

function spanInRange(span: SpanRef, sentences: Sentence[]): boolean {
  const s = sentences[span.sentenceIndex];
  if (!s) return false;
  return span.tokenStart >= 0 && span.tokenStart < span.tokenEnd && span.tokenEnd <= s.tokens.length;
}

function renderSpan(sentence: Sentence, span: SpanRef): string {
  return tokenizer
    .renderText({ tokens: sentence.tokens.slice(span.tokenStart, span.tokenEnd), translationJa: '' })
    .trim();
}

function stem(word: string): string {
  const w = word.toLowerCase();
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, w.length - suf.length);
  }
  return w;
}

/** Conservative inflection test: equality, explicit list, or shared morphological stem. */
function isInflectionOf(form: string, base: string, inflections?: string[]): boolean {
  const f = form.toLowerCase();
  const b = base.toLowerCase();
  if (f === b) return true;
  if (inflections?.some((i) => i.toLowerCase() === f)) return true;
  const sf = stem(f);
  const sb = stem(b);
  return sf === sb || sf.startsWith(sb) || sb.startsWith(sf);
}

const isWord = (token: string): boolean => /[a-zA-Z]/.test(token);

// ── Service ──────────────────────────────────────────────────────────────────

function validate(candidate: PassageOutput, ctx: ValidationContext): ValidationReport {
  const violations: SpanViolation[] = [];
  const { sentences } = candidate;
  const targetById = new Map(ctx.targets.map((t) => [t.wordId, t]));

  // TargetSpans: range + surface fidelity + inflection.
  for (const span of candidate.targetSpans) {
    if (!spanInRange(span, sentences)) {
      violations.push({ kind: 'span_out_of_range', detail: `target ${span.wordId} @${span.sentenceIndex}` });
      continue;
    }
    const rendered = renderSpan(sentences[span.sentenceIndex]!, span);
    if (rendered.toLowerCase() !== span.surface.toLowerCase()) {
      violations.push({
        kind: 'surface_mismatch',
        detail: `declared "${span.surface}" ≠ tokens "${rendered}"`,
      });
      continue;
    }
    const target = targetById.get(span.wordId);
    if (target && !isInflectionOf(span.surface, target.surface, target.inflections)) {
      violations.push({
        kind: 'surface_mismatch',
        detail: `"${span.surface}" is not an inflection of "${target.surface}"`,
      });
    }
  }

  // CollocationSpans: range only.
  for (const span of candidate.collocationSpans) {
    if (!spanInRange(span, sentences)) {
      violations.push({ kind: 'span_out_of_range', detail: `collocation ${span.collocationId}` });
    }
  }

  // NoticeCues: range + anchor fidelity + grounding + category consistency. Every violation here
  // carries `cueIndex` so the orchestrator can drop just this cue as a last resort.
  for (const cue of candidate.noticeCues) {
    if (!spanInRange(cue.span, sentences)) {
      violations.push({ kind: 'span_out_of_range', detail: `cue #${cue.index}`, cueIndex: cue.index });
      continue;
    }
    // Load-bearing: the badge (PassageRenderer) and the rail expression (NoticeRail) are both
    // derived from cue.span, so the span MUST render exactly the cue's declared anchorText —
    // otherwise the in-text marker drifts off what explanationJa describes (the bug this guards).
    // reanchorSpans rebuilds the span from anchorText; this turns any residual drift into a
    // repairable (then droppable) violation instead of a silent mismatch shipped to the UI.
    const renderedAnchor = renderSpan(sentences[cue.span.sentenceIndex]!, cue.span);
    if (renderedAnchor.toLowerCase() !== cue.anchorText.trim().toLowerCase()) {
      violations.push({
        kind: 'cue_surface_mismatch',
        detail: `cue #${cue.index} anchor "${cue.anchorText}" ≠ tokens "${renderedAnchor}"`,
        cueIndex: cue.index,
      });
    }
    // Attribute-grounding applies only to legacy target-word cues (those that declare a
    // sourceAttribute / wordId). Exhaustive annotation-pass cues omit both and are validated by
    // location only (above); their correctness is the annotation pass's responsibility.
    const allowed = CATEGORY_ATTRIBUTES[cue.category];
    if (cue.sourceAttribute !== undefined && !allowed.includes(cue.sourceAttribute)) {
      violations.push({
        kind: 'cue_category_mismatch',
        detail: `cue #${cue.index} category ${cue.category} cites "${cue.sourceAttribute}"`,
        cueIndex: cue.index,
      });
      continue;
    }
    if (cue.wordId !== undefined) {
      const target = targetById.get(cue.wordId);
      // Ground by category (not the literal sourceAttribute) — models are inconsistent about the
      // `more.` prefix, so a cue is attested when the category's canonical attribute is present.
      if (!isCueGrounded(cue.category, target?.attributes)) {
        violations.push({
          kind: 'cue_unattested',
          detail: `cue #${cue.index} ${cue.category} not grounded for ${cue.wordId}`,
          cueIndex: cue.index,
        });
      }
    }
  }

  // CEFR vocabulary profile (over tokens with a known band).
  let known = 0;
  let offBand = 0;
  for (const sentence of sentences) {
    for (const token of sentence.tokens) {
      if (!isWord(token)) continue;
      const band = ctx.cefrOf?.(token.toLowerCase());
      if (!band) continue;
      known += 1;
      if (CEFR_RANK[band] > CEFR_RANK[ctx.level]) offBand += 1;
    }
  }
  const cefrOffBandRatio = known > 0 ? offBand / known : 0;
  if (cefrOffBandRatio > CEFR_OUT_OF_BAND_TOLERANCE) {
    violations.push({
      kind: 'cefr_out_of_band',
      detail: `out-of-band ratio ${cefrOffBandRatio.toFixed(2)} > ${CEFR_OUT_OF_BAND_TOLERANCE}`,
    });
  }

  // Length: total word count must stay within a (loose) band of the requested target so a
  // passage that ignores the requested length is rejected and regenerated.
  if (ctx.approxWords !== undefined && ctx.approxWords > 0) {
    let totalWords = 0;
    for (const sentence of sentences) {
      for (const token of sentence.tokens) {
        if (isWord(token)) totalWords += 1;
      }
    }
    const lo = ctx.approxWords * (1 - LENGTH_WORD_TOLERANCE);
    const hi = ctx.approxWords * (1 + LENGTH_WORD_TOLERANCE);
    if (totalWords < lo || totalWords > hi) {
      violations.push({
        kind: 'length_out_of_range',
        detail: `passage has ${totalWords} words vs requested ~${ctx.approxWords}`,
      });
    }
  }

  // Note: the new/review balance (newWordRatio) is determined by which words SessionPlanner
  // selects — the model only copies each target's masteryDensity — so it is a selection
  // concern, not something to validate on the generated output (it cannot be repaired here).

  return { ok: violations.length === 0, violations, cefrOffBandRatio };
}

export const passageValidator: PassageValidator = { validate };

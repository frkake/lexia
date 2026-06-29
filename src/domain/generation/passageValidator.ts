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
import type { Cefr, NoticeCategory, PassageOutput, Sentence, SpanRef } from '../../types/domain';

export type SpanViolationKind =
  | 'span_out_of_range'
  | 'surface_mismatch'
  | 'cue_unattested'
  | 'cue_category_mismatch'
  | 'cefr_out_of_band'
  | 'new_ratio_out_of_range';

export interface SpanViolation {
  kind: SpanViolationKind;
  detail: string;
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
  /** Requested new-word ratio; checked leniently when present. */
  newWordRatio?: number;
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

/** Attribute keys (dotted paths into WordData) each cue category may cite. */
const CATEGORY_ATTRIBUTES: Record<NoticeCategory, string[]> = {
  connotation: ['connotation'],
  collocation: ['core.collocations', 'collocations'],
  register: ['register'],
  etymology: ['more.etymology', 'etymology'],
  semantic_network: ['more.semanticNetwork', 'semanticNetwork'],
  synonym_nuance: ['core.synonymNuances', 'synonymNuances'],
  grammar_pattern: ['more.grammarPatterns', 'grammarPatterns'],
  word_family: ['more.wordFamily', 'wordFamily'],
  frequency: ['frequency'],
  common_error: ['more.commonErrors', 'commonErrors'],
};

const NEW_RATIO_TOLERANCE = 0.5;
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

/** Resolve a dotted path and report whether it holds a non-empty value. */
function hasAttribute(attributes: Record<string, unknown> | undefined, path: string): boolean {
  if (!attributes) return false;
  let cur: unknown = attributes;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === undefined || cur === null) return false;
  if (Array.isArray(cur)) return cur.length > 0;
  if (typeof cur === 'string') return cur.trim().length > 0;
  if (typeof cur === 'object') return Object.keys(cur as object).length > 0;
  return true; // numbers, booleans
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

  // NoticeCues: range + grounding + category consistency.
  for (const cue of candidate.noticeCues) {
    if (!spanInRange(cue.span, sentences)) {
      violations.push({ kind: 'span_out_of_range', detail: `cue #${cue.index}` });
      continue;
    }
    const allowed = CATEGORY_ATTRIBUTES[cue.category];
    if (!allowed.includes(cue.sourceAttribute)) {
      violations.push({
        kind: 'cue_category_mismatch',
        detail: `cue #${cue.index} category ${cue.category} cites "${cue.sourceAttribute}"`,
      });
      continue;
    }
    const target = targetById.get(cue.wordId);
    if (!hasAttribute(target?.attributes, cue.sourceAttribute)) {
      violations.push({
        kind: 'cue_unattested',
        detail: `cue #${cue.index} "${cue.sourceAttribute}" missing for ${cue.wordId}`,
      });
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

  // New-word ratio (lenient — only gross deviation, needs enough distinct targets).
  if (ctx.newWordRatio !== undefined) {
    const distinct = new Map(candidate.targetSpans.map((s) => [s.wordId, s.masteryDensity]));
    if (distinct.size >= 3) {
      const newCount = [...distinct.values()].filter((d) => d === 'new').length;
      const actual = newCount / distinct.size;
      if (Math.abs(actual - ctx.newWordRatio) > NEW_RATIO_TOLERANCE) {
        violations.push({
          kind: 'new_ratio_out_of_range',
          detail: `new ratio ${actual.toFixed(2)} vs requested ${ctx.newWordRatio}`,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations, cefrOffBandRatio };
}

export const passageValidator: PassageValidator = { validate };

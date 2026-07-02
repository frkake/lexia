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
  | 'length_out_of_range'
  | 'translation_span_mismatch'
  | 'verbatim_copy';

/** Minimum consecutive-word run (matched verbatim against a homage reference) that counts as copying. */
export const VERBATIM_COPY_MIN_RUN = 8;

/** Identifies a translation-side span by sentence + JA char range (for last-resort dropping). */
export interface TranslationSpanRef {
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
}

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
  /**
   * Set for a `translation_span_mismatch`: the offending JA-side span (by sentence + char range)
   * so the orchestrator can drop just that emphasis as a last resort, leaving the body intact.
   */
  translationSpan?: TranslationSpanRef;
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
  /**
   * Reference text of the homage work (Requirement 6.5). When present, the validator flags long
   * verbatim consecutive runs shared with it as `verbatim_copy` (copyright guard). Absent for
   * originals/articles ⇒ the check is skipped.
   */
  homageReference?: string;
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

/** Lowercased word tokens of a free-text string (letters/digits runs), for verbatim-run matching. */
function wordSequence(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

/**
 * Length (in words) of the longest run of the passage's words that appears verbatim and consecutively
 * in the homage reference. A long shared run indicates copied text (Requirement 6.5). O(n·m) over the
 * word counts — fine for a passage vs. a short style reference.
 */
function longestVerbatimRun(passageWords: string[], referenceWords: string[]): number {
  if (passageWords.length === 0 || referenceWords.length === 0) return 0;
  const m = referenceWords.length;
  // prev[j] = length of the shared run ending at passageWords[i-1] & referenceWords[j-1].
  let prev = new Array<number>(m + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= passageWords.length; i += 1) {
    const cur = new Array<number>(m + 1).fill(0);
    for (let j = 1; j <= m; j += 1) {
      if (passageWords[i - 1] === referenceWords[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

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

  // Translation-side new-element consistency: a JA span flagged isNew=true must correspond to an
  // English-side target word whose masteryDensity is 'new' (4.4). A genuinely-new emphasis on a
  // review/known word is the mismatch this guards. Each violation carries the offending span so the
  // orchestrator can drop just that emphasis as a last resort (harmless: the body text is kept).
  const newWordIds = new Set(
    candidate.targetSpans.filter((s) => s.masteryDensity === 'new').map((s) => s.wordId),
  );
  for (let si = 0; si < sentences.length; si += 1) {
    const spans = sentences[si]!.translationSpans;
    if (!spans) continue;
    for (const span of spans) {
      if (!span.isNew) continue; // only "new"-flagged emphasis is constrained
      const linkedIsNew = span.wordId !== undefined && newWordIds.has(span.wordId);
      if (!linkedIsNew) {
        violations.push({
          kind: 'translation_span_mismatch',
          detail: `translation span @${si}[${span.charStart},${span.charEnd}) flagged new but ${
            span.wordId ? `target "${span.wordId}" is not new` : 'has no new target'
          }`,
          translationSpan: { sentenceIndex: si, charStart: span.charStart, charEnd: span.charEnd },
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

  // Homage verbatim-copy guard (6.5): when a homage reference is supplied, a long consecutive run
  // shared with it indicates copied text (not the style/motif reference we allow). Lightweight —
  // skipped entirely for originals/articles (no reference).
  if (ctx.homageReference && ctx.homageReference.trim()) {
    const passageWords = sentences.flatMap((s) => wordSequence(s.tokens.join(' ')));
    const referenceWords = wordSequence(ctx.homageReference);
    const run = longestVerbatimRun(passageWords, referenceWords);
    if (run >= VERBATIM_COPY_MIN_RUN) {
      violations.push({
        kind: 'verbatim_copy',
        detail: `passage shares a ${run}-word verbatim run with the homage source (≥ ${VERBATIM_COPY_MIN_RUN})`,
      });
    }
  }

  // Note: the new/review balance (newWordRatio) is determined by which words SessionPlanner
  // selects — the model only copies each target's masteryDensity — so it is a selection
  // concern, not something to validate on the generated output (it cannot be repaired here).

  return { ok: violations.length === 0, violations, cefrOffBandRatio };
}

export const passageValidator: PassageValidator = { validate };

/**
 * L1 — GenerationOrchestrator: drives the generate → validate → repair loop and
 * yields a UI-ready IndexedPassage (design.md "GenerationOrchestrator", Flow 1).
 *   - calls ContentGateway.generatePassage and inspects `stopReason`
 *     (`refusal`/`max_tokens` ⇒ regenerate, up to a limit);
 *   - validates with PassageValidator; on violations, repairs (re-requests) up to a
 *     limit, returning `validation_exhausted` with the last report on overrun;
 *   - on success, indexes the passage with the single-source-of-truth tokenizer.
 * Stays pure of I/O specifics by depending only on the ContentGateway port.
 */

import { tokenizer } from '../tokenizer/joinService';
import { passageValidator } from './passageValidator';
import { readabilityForCefr } from '../difficulty/levelPreset';
import type {
  PassageValidator,
  SpanViolation,
  SpanViolationKind,
  ValidationContext,
  ValidationReport,
  ValidationTarget,
} from './passageValidator';
import { ok, err, type Result } from '../../types/result';
import type { ContentGateway } from '../../types/ports';
import type {
  AnnotationStatus,
  Cefr,
  CollocationSpan,
  ExpressionSpan,
  GenerationRequest,
  IndexedPassage,
  NoticeCue,
  PassageMeta,
  PassageOutput,
  Sentence,
  SyntaxSpan,
  TargetSpan,
} from '../../types/domain';

export type GenerationError =
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'validation_exhausted'; lastReport: ValidationReport };

/** The in-flight sub-phases the orchestrator reports so the UI progress panel can name the step (D-7). */
export type GenerationRunPhase = 'passage' | 'repair' | 'annotate';

export interface GenerateOptions {
  /** Cancels the in-flight generation (threaded to every ContentGateway call). */
  signal?: AbortSignal;
  /** Called as the run enters each sub-phase (body generation → repair → annotation). */
  onPhase?: (phase: GenerationRunPhase) => void;
}

export interface GenerationOrchestrator {
  generate(req: GenerationRequest, options?: GenerateOptions): Promise<Result<IndexedPassage, GenerationError>>;
}

export interface OrchestratorDeps {
  gateway: ContentGateway;
  validator?: PassageValidator;
  /** External CEFR band lookup for the vocabulary-profile gate. */
  cefrOf?: (token: string) => Cefr | undefined;
  /** Regeneration budget for refusal / max_tokens stop reasons (default 2). */
  maxRegenerations?: number;
  /** Repair budget for validation violations (default 2). */
  maxRepairs?: number;
  /** Build the next (possibly augmented) request after a failed validation. */
  buildRepairRequest?: (req: GenerationRequest, report: ValidationReport) => GenerationRequest;
  /** Stable id for the produced passage (the state layer supplies a unique one). */
  passageId?: string;
}

/** Derive the validation context from the request (targets carry attributes). */
function contextFor(req: GenerationRequest, cefrOf?: OrchestratorDeps['cefrOf']): ValidationContext {
  const targets: ValidationTarget[] = req.targetWords.map((t) => ({
    wordId: t.wordId,
    surface: t.surface,
    attributes: t.attributes,
  }));
  return {
    level: req.level,
    targets,
    approxWords: req.wordTarget,
    cefrOf,
    // B-3: the requested sentence-structure band drives the sentence-length + advanced-syntax gates.
    // Mirror the prompt's fallback so the validator judges against exactly what the model was asked.
    readabilityLevel: req.readabilityLevel ?? readabilityForCefr(req.level),
  };
}

/** Turn a violation into an actionable instruction the model can act on in the next attempt. */
const REPAIR_HINT: Record<SpanViolationKind, string> = {
  length_out_of_range: 'Adjust the total word count to be close to the requested approxWords.',
  cefr_out_of_band: 'Replace advanced words with simpler synonyms at or below the requested CEFR level.',
  surface_mismatch: 'Make each targetSpan surface match its tokens and be an inflection of the target word.',
  span_out_of_range: 'Fix the token indices so every span stays inside its sentence.',
  cue_unattested: 'Only add a notice cue that cites an attribute actually supplied for that word, or omit it.',
  cue_category_mismatch: 'Make each notice cue category match the attribute it cites, or omit the cue.',
  cue_surface_mismatch:
    "Set each notice cue's anchorText to the exact word(s) it is about, copied verbatim from that sentence, and place its span on exactly those tokens.",
  translation_span_mismatch:
    'Only flag a translation span as new when it corresponds to a target word whose masteryDensity is "new"; remove the emphasis otherwise.',
  verbatim_copy:
    'Do not copy sentences verbatim from the referenced work; write original prose that only echoes its style and motifs.',
  expression_quota_unmet:
    'Weave in more high-frequency idioms / phrasal verbs / set phrases until the requested quotas are met, and self-report each one in expressionSpans.',
  expression_span_mismatch:
    "Set each expressionSpan's surface to the exact tokens it covers (verbatim) and place its span on exactly those tokens.",
  collocation_missing:
    'Weave each target word into at least one of its supplied core.collocations and add a covering collocationSpan.',
  collocation_id_unknown:
    "Every collocationId must be copied verbatim from that word's supplied core.collocations — its id, or, for legacy word data, the collocation string itself; remove or fix invented ones.",
  paragraph_index_invalid:
    'Set paragraphIndex on every sentence starting at 0 and incrementing by 1 at each paragraph break (never decreasing).',
  syntax_repertoire_unmet:
    'At advanced readability, use the required constructions (non-restrictive relative clause, participial construction, inversion or cleft, subjunctive, appositive) and self-report each in syntaxSpans.',
  sentence_length_profile_mismatch:
    'Adjust average sentence length to the requested readability band: easy 8-12, standard 12-16, advanced 16-24 words per sentence.',
};

function describeViolation(v: SpanViolation): string {
  return `${REPAIR_HINT[v.kind]} (${v.detail})`;
}

/**
 * Last-resort salvage: remove the cue-local faults the validator flagged so a passage whose only
 * faults are droppable can still be accepted. This covers (a) notice cues flagged by `cueIndex`
 * (mislocated badge) and (b) translation-side emphasis flagged by `translationSpan` (a new-flag
 * mismatch) — both are harmless to drop, leaving the body text intact. Returns null when nothing
 * droppable was flagged (i.e. the failure is a non-droppable passage/target violation).
 */
function dropFailingCues(passage: PassageOutput, report: ValidationReport): PassageOutput | null {
  const badCues = new Set(
    report.violations.map((v) => v.cueIndex).filter((i): i is number => i !== undefined),
  );
  const badTranslationSpans = report.violations
    .map((v) => v.translationSpan)
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  if (badCues.size === 0 && badTranslationSpans.length === 0) return null;

  let sentences = passage.sentences;
  if (badTranslationSpans.length > 0) {
    const bySentence = new Map<number, Set<string>>();
    for (const t of badTranslationSpans) {
      const set = bySentence.get(t.sentenceIndex) ?? new Set<string>();
      set.add(`${t.charStart}:${t.charEnd}`);
      bySentence.set(t.sentenceIndex, set);
    }
    sentences = passage.sentences.map((s, si) => {
      const drop = bySentence.get(si);
      if (!drop || !s.translationSpans) return s;
      const kept = s.translationSpans.filter((sp) => !drop.has(`${sp.charStart}:${sp.charEnd}`));
      return { ...s, translationSpans: kept };
    });
  }

  return {
    ...passage,
    sentences,
    noticeCues: passage.noticeCues.filter((c) => !badCues.has(c.index)),
  };
}

/** Default repair: re-issue the request annotated with what failed so the retry is guided, not blind. */
function defaultBuildRepair(req: GenerationRequest, report: ValidationReport): GenerationRequest {
  return { ...req, repairFeedback: report.violations.map(describeViolation) };
}

/** Quality-level violations that ship as `meta.qualityWarnings` rather than hard-failing (B-1 / R4). */
const QUALITY_VIOLATION_KINDS: ReadonlySet<SpanViolationKind> = new Set<SpanViolationKind>([
  'expression_quota_unmet',
  'expression_span_mismatch',
  'collocation_missing',
  'collocation_id_unknown',
  'paragraph_index_invalid',
  // B-3: a readable passage must not be discarded over a missed sentence-length band or an
  // under-covered advanced-syntax repertoire — ship it with a qualityWarning instead (R4).
  'sentence_length_profile_mismatch',
  'syntax_repertoire_unmet',
]);

/**
 * True when a passage's only remaining faults are shippable as-is: a missed length band and/or
 * quality-level shortfalls (idiom/set-phrase quota, collocation coverage, paragraph structure,
 * sentence-length profile, advanced-syntax repertoire). Such
 * a passage is readable and worth shipping as a last resort — with `qualityWarnings` — rather than
 * hard-failing the whole generation (B-1). Non-shippable structural faults (target surface, span
 * range, CEFR, translation-span, verbatim copy) still block acceptance.
 */
function isShippableResidual(report: ValidationReport): boolean {
  return (
    report.violations.length > 0 &&
    report.violations.every((v) => v.kind === 'length_out_of_range' || QUALITY_VIOLATION_KINDS.has(v.kind))
  );
}

/** Human-readable warnings for the quality-level violations a shipped passage still carried (B-1). */
function qualityWarningsFor(report: ValidationReport): string[] {
  return report.violations.filter((v) => QUALITY_VIOLATION_KINDS.has(v.kind)).map(describeViolation);
}

/**
 * Physically achievable word target for a SINGLE generation request. The token budget
 * (`lengthSpec.tokenBudgetFor`) is clamped to the provider ceiling, so a target much above this
 * cannot fit in one reply — regenerating at the same target just truncates again. floor((16000-1200)/9)
 * ≈ 1644, so 1600 leaves headroom. Two things key off it: the single-shot adaptive retreat after a
 * `max_tokens` truncation, and the threshold above which generation switches to the chunked path.
 */
const MAX_ADAPTIVE_WORD_TARGET = 1600;

/**
 * Word target per segment when a large passage is generated in chunks (B-5 第2弾). Kept well below
 * `MAX_ADAPTIVE_WORD_TARGET` so each segment's token budget has ample headroom for the batch-1 extras
 * (expressionSpans, paragraphIndex). A request for `wordTarget` is split into `ceil(wordTarget / this)`
 * evenly-sized segments generated in sequence.
 */
const CHUNK_TARGET_WORDS = 1200;

/** How many trailing sentences of the passage-so-far feed the next segment's continuation summary. */
const CONTINUATION_TAIL_SENTENCES = 6;
/** Character cap on the continuation summary passed to the next segment (keeps the prompt bounded). */
const CONTINUATION_SUMMARY_MAX_CHARS = 600;

const isWordToken = (token: string): boolean => /[a-zA-Z]/.test(token);

/** Total English word count of a passage body (mirrors the validator's length-gate word count). */
function countWords(passage: PassageOutput): number {
  let total = 0;
  for (const sentence of passage.sentences) {
    for (const token of sentence.tokens) if (isWordToken(token)) total += 1;
  }
  return total;
}

/**
 * Japanese continuation summary handed to the next segment (the priorSummaryJa mechanism, reused for
 * non-story long form): the tail of the passage generated so far, in Japanese (`translationJa`), so
 * the next segment picks up where the prose left off instead of restarting. Empty before any segment.
 */
function summarizeTail(produced: PassageOutput[]): string {
  const sentences = produced.flatMap((p) => p.sentences);
  const tail = sentences
    .slice(-CONTINUATION_TAIL_SENTENCES)
    .map((s) => s.translationJa.trim())
    .filter((t) => t.length > 0)
    .join(' ');
  return tail.length > CONTINUATION_SUMMARY_MAX_CHARS ? tail.slice(tail.length - CONTINUATION_SUMMARY_MAX_CHARS) : tail;
}

/**
 * Concatenate the sequentially-generated segments into one `PassageOutput`. Each segment's spans are
 * sentence-relative (`SpanRef.sentenceIndex`), so every reference in a later segment is shifted by the
 * running sentence offset; paragraph numbering is continued so `paragraphIndex` stays monotonic
 * non-decreasing across the whole body (a fresh segment starts a new paragraph). Cue indices are
 * re-issued to stay globally unique. Meta is rebuilt from the merged body (title/intent/level from the
 * opening segment; counts + approxWords recomputed).
 */
function mergeChunks(produced: PassageOutput[]): PassageOutput {
  const sentences: Sentence[] = [];
  const targetSpans: TargetSpan[] = [];
  const collocationSpans: CollocationSpan[] = [];
  const noticeCues: NoticeCue[] = [];
  const expressionSpans: ExpressionSpan[] = [];
  let hasExpressionSpans = false;
  const syntaxSpans: SyntaxSpan[] = [];
  let hasSyntaxSpans = false;
  let sentenceOffset = 0;
  let paragraphOffset = 0;
  let cueIndex = 1;

  for (const chunk of produced) {
    const chunkHasParagraphs =
      chunk.sentences.length > 0 && chunk.sentences.every((s) => typeof s.paragraphIndex === 'number');
    let maxParagraph = -1;
    for (const s of chunk.sentences) {
      if (chunkHasParagraphs && typeof s.paragraphIndex === 'number') {
        if (s.paragraphIndex > maxParagraph) maxParagraph = s.paragraphIndex;
        sentences.push({ ...s, paragraphIndex: s.paragraphIndex + paragraphOffset });
      } else {
        sentences.push({ ...s });
      }
    }
    if (chunkHasParagraphs && maxParagraph >= 0) paragraphOffset += maxParagraph + 1;

    for (const t of chunk.targetSpans) targetSpans.push({ ...t, sentenceIndex: t.sentenceIndex + sentenceOffset });
    for (const c of chunk.collocationSpans)
      collocationSpans.push({ ...c, sentenceIndex: c.sentenceIndex + sentenceOffset });
    for (const cue of chunk.noticeCues)
      noticeCues.push({ ...cue, index: cueIndex++, span: { ...cue.span, sentenceIndex: cue.span.sentenceIndex + sentenceOffset } });
    if (chunk.expressionSpans !== undefined) {
      hasExpressionSpans = true;
      for (const es of chunk.expressionSpans)
        expressionSpans.push({ ...es, span: { ...es.span, sentenceIndex: es.span.sentenceIndex + sentenceOffset } });
    }
    if (chunk.syntaxSpans !== undefined) {
      hasSyntaxSpans = true;
      for (const ss of chunk.syntaxSpans)
        syntaxSpans.push({ ...ss, sentenceIndex: ss.sentenceIndex + sentenceOffset });
    }
    sentenceOffset += chunk.sentences.length;
  }

  const newCount = new Set(targetSpans.filter((t) => t.masteryDensity === 'new').map((t) => t.wordId)).size;
  const reviewCount = new Set(targetSpans.filter((t) => t.masteryDensity !== 'new').map((t) => t.wordId)).size;
  const base = produced[0]!.meta;
  const meta: PassageMeta = {
    ...base,
    newCount,
    reviewCount,
    approxWords: sentences.reduce((n, s) => n + s.tokens.filter(isWordToken).length, 0),
  };

  return {
    meta,
    sentences,
    targetSpans,
    collocationSpans,
    noticeCues,
    ...(hasExpressionSpans ? { expressionSpans } : {}),
    ...(hasSyntaxSpans ? { syntaxSpans } : {}),
  };
}

export function createGenerationOrchestrator(deps: OrchestratorDeps): GenerationOrchestrator {
  const validator = deps.validator ?? passageValidator;
  const maxRegenerations = deps.maxRegenerations ?? 2;
  const maxRepairs = deps.maxRepairs ?? 2;
  const buildRepair = deps.buildRepairRequest ?? defaultBuildRepair;
  const passageId = deps.passageId ?? 'passage';

  async function generate(
    req: GenerationRequest,
    options: GenerateOptions = {},
  ): Promise<Result<IndexedPassage, GenerationError>> {
    const { signal, onPhase } = options;
    const ctx = contextFor(req, deps.cefrOf);
    // Set when an adaptive retry retreats the word target after a max_tokens truncation, so the
    // accepted passage records the target actually used (`meta.effectiveWordTarget`).
    let effectiveWordTarget: number | undefined;

    // After a passage is accepted, enrich it with the exhaustive annotation pass (a second LLM call
    // run ONCE on the final text). Failure is non-fatal: ship the passage with whatever cues it has.
    // `report` is the validation report that accepted this passage; its measured CEFR profile is
    // stamped onto meta (B-4) so the reader/measurement layer sees the actual out-of-band ratio.
    const finalize = async (
      passage: PassageOutput,
      report: ValidationReport,
      qualityWarnings?: string[],
    ): Promise<Result<IndexedPassage, GenerationError>> => {
      // Only record a profile when a dictionary actually matched tokens (sampleSize > 0); with no
      // cefrOf injected the ratio is a meaningless 0, so leave meta untouched (back-compat).
      const vocabProfile =
        report.cefrSampleSize > 0
          ? { offBandRatio: report.cefrOffBandRatio, sampleSize: report.cefrSampleSize }
          : undefined;
      // Record the length shortfall when the accepting report still carries a length violation (the
      // passage shipped shorter/longer than the band as a last resort, B-5 第2弾). `requested` is the
      // learner's original target; `actual` is the measured body length. Absent on a clean length pass.
      const lengthShortfall =
        req.wordTarget > 0 && report.violations.some((v) => v.kind === 'length_out_of_range')
          ? { requested: req.wordTarget, actual: countWords(passage) }
          : undefined;
      const metaExtras = {
        ...(effectiveWordTarget !== undefined ? { effectiveWordTarget } : {}),
        ...(vocabProfile !== undefined ? { vocabProfile } : {}),
        ...(lengthShortfall !== undefined ? { lengthShortfall } : {}),
        // Residual quality shortfalls the passage shipped WITH (B-1): recorded so the reader can
        // surface them (theme D). Absent on a clean pass.
        ...(qualityWarnings && qualityWarnings.length > 0 ? { qualityWarnings } : {}),
      };
      const stamped =
        Object.keys(metaExtras).length > 0
          ? { ...passage, meta: { ...passage.meta, ...metaExtras } }
          : passage;
      let noticeCues = stamped.noticeCues;
      // C-4: sentence-level syntax notes for hard sentences come back from the annotation pass and are
      // attached to the passage. Undefined ⇒ no notes produced (leave the passage's field untouched).
      let syntaxNotes = stamped.syntaxNotes;
      // Undefined ⇒ no annotation pass ran (gateway without the enrichment) → leave meta untouched.
      // Otherwise record complete/partial/failed so the reader can surface a banner + regenerate.
      let annotationStatus: AnnotationStatus | undefined;
      try {
        onPhase?.('annotate');
        // Pass the body-mark spans (study words + collocations) as REQUIRED COVERAGE so the notice
        // rail covers every in-text mark — one consistent set, not two independently-chosen ones. C-4:
        // pass the readability band + the sentences the generator self-flagged as hard (syntaxSpans) so
        // the pass emits the required syntaxNotes.
        const hardSentenceIndexes = stamped.syntaxSpans
          ? [...new Set(stamped.syntaxSpans.map((s) => s.sentenceIndex))].sort((a, b) => a - b)
          : undefined;
        const annotated = await deps.gateway.annotatePassage?.(
          {
            sentences: stamped.sentences,
            level: req.level,
            readabilityLevel: req.readabilityLevel ?? readabilityForCefr(req.level),
            hardSentenceIndexes,
            targetSpans: stamped.targetSpans,
            collocationSpans: stamped.collocationSpans,
            expressionSpans: stamped.expressionSpans,
          },
          signal,
        );
        if (annotated) {
          noticeCues = annotated.noticeCues;
          annotationStatus = annotated.status;
          if (annotated.sentenceNotes && annotated.sentenceNotes.length > 0) syntaxNotes = annotated.sentenceNotes;
        }
      } catch {
        // Degrade: keep the passage readable; the annotation loss is recorded (not silent).
        annotationStatus = 'failed';
      }
      const meta = annotationStatus !== undefined ? { ...stamped.meta, annotationStatus } : stamped.meta;
      const withNotes = syntaxNotes !== undefined ? { ...stamped, syntaxNotes } : stamped;
      return ok(tokenizer.index(passageId, { ...withNotes, meta, noticeCues }));
    };

    // Last-resort acceptance for a candidate whose validation `report` failed: drop the cue-local
    // faults, then ship a residual whose only remaining faults are length + quality (recording the
    // length shortfall + quality warnings on meta), else surface `validation_exhausted`. Shared by the
    // single-shot loop (after its repair budget is spent) and the chunked path (which has no repair
    // loop — it validates the concatenated body once).
    const shipOrFail = async (
      candidate: PassageOutput,
      report: ValidationReport,
    ): Promise<Result<IndexedPassage, GenerationError>> => {
      const salvaged = dropFailingCues(candidate, report);
      if (salvaged) {
        const salvagedReport = validator.validate(salvaged, ctx);
        if (salvagedReport.ok) return finalize(salvaged, salvagedReport);
      }
      const residual = salvaged ?? candidate;
      const residualReport = validator.validate(residual, ctx);
      if (isShippableResidual(residualReport)) {
        return finalize(residual, residualReport, qualityWarningsFor(residualReport));
      }
      return err({ kind: 'validation_exhausted', lastReport: report });
    };

    // Produce ONE raw passage for a chunked segment: handle the refusal / max_tokens stop reasons
    // (with the same adaptive retreat) but leave validation to the merged body. Returns the raw
    // PassageOutput on a normal stop, or the stop-reason error once the regeneration budget is spent.
    const fetchChunk = async (chunkReq: GenerationRequest): Promise<Result<PassageOutput, GenerationError>> => {
      let attemptReq = chunkReq;
      let regenLeft = maxRegenerations;
      for (;;) {
        onPhase?.('passage');
        const resp = await deps.gateway.generatePassage(attemptReq, signal);
        if (resp.stopReason === 'refusal') {
          if (regenLeft <= 0) return err({ kind: 'refusal' });
          regenLeft -= 1;
          continue;
        }
        if (resp.stopReason === 'max_tokens') {
          if (regenLeft <= 0) return err({ kind: 'max_tokens' });
          regenLeft -= 1;
          const reduced = Math.min(attemptReq.wordTarget, MAX_ADAPTIVE_WORD_TARGET);
          if (reduced < attemptReq.wordTarget) attemptReq = { ...attemptReq, wordTarget: reduced };
          continue;
        }
        return ok(resp.passage);
      }
    };

    // Chunked long-form generation (B-5 第2弾): a target above the single-request ceiling is split
    // into `ceil / CHUNK_TARGET_WORDS` evenly-sized segments generated in sequence, each carrying a
    // Japanese summary of what came before (continuation context) so the segments read as one piece.
    // The concatenated body is validated ONCE. Partial rescue: if a later segment fails after ≥1
    // landed, the prefix is shipped (a shorter passage with `meta.lengthShortfall` recorded) rather
    // than losing everything; a first-segment failure has nothing to rescue and surfaces the error.
    const generateChunked = async (): Promise<Result<IndexedPassage, GenerationError>> => {
      const segmentCount = Math.ceil(req.wordTarget / CHUNK_TARGET_WORDS);
      const perSegmentTarget = Math.round(req.wordTarget / segmentCount);
      const produced: PassageOutput[] = [];
      for (let i = 0; i < segmentCount; i += 1) {
        const chunkReq: GenerationRequest = {
          ...req,
          wordTarget: perSegmentTarget,
          continuationContext: { segmentIndex: i, segmentCount, priorSummaryJa: summarizeTail(produced) },
        };
        const chunk = await fetchChunk(chunkReq);
        if (!chunk.ok) {
          if (produced.length === 0) return chunk;
          break; // partial rescue: ship the prefix produced so far
        }
        produced.push(chunk.value);
      }
      const combined = mergeChunks(produced);
      const report = validator.validate(combined, ctx);
      if (report.ok) return finalize(combined, report);
      return shipOrFail(combined, report);
    };

    // Targets that cannot fit in one reply are generated segment-by-segment and concatenated.
    if (req.wordTarget > MAX_ADAPTIVE_WORD_TARGET) {
      return generateChunked();
    }

    let attemptReq = req;
    let regenLeft = maxRegenerations;
    let repairLeft = maxRepairs;

    // Each branch either returns or decrements a budget, so the loop terminates.
    for (;;) {
      onPhase?.(repairLeft < maxRepairs ? 'repair' : 'passage');
      const resp = await deps.gateway.generatePassage(attemptReq, signal);

      if (resp.stopReason === 'refusal') {
        if (regenLeft <= 0) return err({ kind: 'refusal' });
        regenLeft -= 1;
        continue;
      }
      if (resp.stopReason === 'max_tokens') {
        if (regenLeft <= 0) return err({ kind: 'max_tokens' });
        regenLeft -= 1;
        // Adaptive retreat after a truncation: cap the target at the achievable ceiling before
        // regenerating so the retry does not truncate again at the same budget. Now that targets
        // above the ceiling take the chunked path, the single-shot loop only ever runs at ≤ ceiling,
        // so this cap is a defensive no-op here; it stays for safety and records any reduction.
        const reduced = Math.min(attemptReq.wordTarget, MAX_ADAPTIVE_WORD_TARGET);
        if (reduced < attemptReq.wordTarget) {
          effectiveWordTarget = reduced;
          attemptReq = { ...attemptReq, wordTarget: reduced };
        }
        continue;
      }

      const report = validator.validate(resp.passage, ctx);
      if (report.ok) {
        return finalize(resp.passage, report);
      }
      if (repairLeft <= 0) {
        // Last resort once the repair budget is spent: drop cue-local faults, then ship a residual
        // whose only remaining faults are length + quality (recording them on meta) rather than
        // failing the whole passage over a mislocated cue or a missed length band. Any other
        // violation (target surface, span range, CEFR, verbatim copy) still blocks it.
        return shipOrFail(resp.passage, report);
      }
      repairLeft -= 1;
      attemptReq = buildRepair(attemptReq, report);
    }
  }

  return { generate };
}

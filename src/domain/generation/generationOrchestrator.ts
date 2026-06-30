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
import type {
  PassageValidator,
  SpanViolation,
  SpanViolationKind,
  ValidationContext,
  ValidationReport,
  ValidationTarget,
} from './passageValidator';
import { APPROX_WORDS } from './lengthSpec';
import { ok, err, type Result } from '../../types/result';
import type { ContentGateway } from '../../types/ports';
import type { Cefr, GenerationRequest, IndexedPassage, PassageOutput } from '../../types/domain';

export type GenerationError =
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'validation_exhausted'; lastReport: ValidationReport };

export interface GenerationOrchestrator {
  generate(req: GenerationRequest): Promise<Result<IndexedPassage, GenerationError>>;
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
    approxWords: APPROX_WORDS[req.length],
    cefrOf,
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

export function createGenerationOrchestrator(deps: OrchestratorDeps): GenerationOrchestrator {
  const validator = deps.validator ?? passageValidator;
  const maxRegenerations = deps.maxRegenerations ?? 2;
  const maxRepairs = deps.maxRepairs ?? 2;
  const buildRepair = deps.buildRepairRequest ?? defaultBuildRepair;
  const passageId = deps.passageId ?? 'passage';

  async function generate(req: GenerationRequest): Promise<Result<IndexedPassage, GenerationError>> {
    const ctx = contextFor(req, deps.cefrOf);

    // After a passage is accepted, enrich it with the exhaustive annotation pass (a second LLM call
    // run ONCE on the final text). Failure is non-fatal: ship the passage with whatever cues it has.
    const finalize = async (passage: PassageOutput): Promise<Result<IndexedPassage, GenerationError>> => {
      let noticeCues = passage.noticeCues;
      try {
        // Pass the body-mark spans (study words + collocations) as REQUIRED COVERAGE so the notice
        // rail covers every in-text mark — one consistent set, not two independently-chosen ones.
        const annotated = await deps.gateway.annotatePassage?.({
          sentences: passage.sentences,
          level: req.level,
          targetSpans: passage.targetSpans,
          collocationSpans: passage.collocationSpans,
        });
        if (annotated) noticeCues = annotated;
      } catch {
        // Degrade: keep the passage readable; notices are simply absent.
      }
      return ok(tokenizer.index(passageId, { ...passage, noticeCues }));
    };

    let attemptReq = req;
    let regenLeft = maxRegenerations;
    let repairLeft = maxRepairs;

    // Each branch either returns or decrements a budget, so the loop terminates.
    for (;;) {
      const resp = await deps.gateway.generatePassage(attemptReq);

      if (resp.stopReason === 'refusal') {
        if (regenLeft <= 0) return err({ kind: 'refusal' });
        regenLeft -= 1;
        continue;
      }
      if (resp.stopReason === 'max_tokens') {
        if (regenLeft <= 0) return err({ kind: 'max_tokens' });
        regenLeft -= 1;
        continue;
      }

      const report = validator.validate(resp.passage, ctx);
      if (report.ok) {
        return finalize(resp.passage);
      }
      if (repairLeft <= 0) {
        // Last resort: the badge ↔ explanation drift this feature guards is cue-local. Drop only
        // the notice cues that fail validation (tagged with `cueIndex`) and accept if nothing else
        // is wrong — better than failing the whole passage over one mislocated cue. Non-cue
        // violations (length / CEFR / target surface) carry no cueIndex, so they still fail.
        const salvaged = dropFailingCues(resp.passage, report);
        if (salvaged && validator.validate(salvaged, ctx).ok) {
          return finalize(salvaged);
        }
        return err({ kind: 'validation_exhausted', lastReport: report });
      }
      repairLeft -= 1;
      attemptReq = buildRepair(attemptReq, report);
    }
  }

  return { generate };
}

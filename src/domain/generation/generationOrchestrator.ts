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
import type { PassageValidator, ValidationContext, ValidationReport, ValidationTarget } from './passageValidator';
import { ok, err, type Result } from '../../types/result';
import type { ContentGateway } from '../../types/ports';
import type { Cefr, GenerationRequest, IndexedPassage } from '../../types/domain';

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
  return { level: req.level, targets, newWordRatio: req.newWordRatio, cefrOf };
}

export function createGenerationOrchestrator(deps: OrchestratorDeps): GenerationOrchestrator {
  const validator = deps.validator ?? passageValidator;
  const maxRegenerations = deps.maxRegenerations ?? 2;
  const maxRepairs = deps.maxRepairs ?? 2;
  const buildRepair = deps.buildRepairRequest ?? ((r) => r);
  const passageId = deps.passageId ?? 'passage';

  async function generate(req: GenerationRequest): Promise<Result<IndexedPassage, GenerationError>> {
    const ctx = contextFor(req, deps.cefrOf);
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
        return ok(tokenizer.index(passageId, resp.passage));
      }
      if (repairLeft <= 0) {
        return err({ kind: 'validation_exhausted', lastReport: report });
      }
      repairLeft -= 1;
      attemptReq = buildRepair(attemptReq, report);
    }
  }

  return { generate };
}

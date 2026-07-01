/**
 * L1 — StoryPlanner (Requirement 6). Owns the story flow that sits before/around the existing
 * passage pipeline:
 *   - planStory: generate the character/plot/chapter scaffold via the StoryGateway BEFORE any body
 *     text (6.2). No mock fallback — a gateway failure is surfaced as an error (project policy).
 *   - confirmPlan: persist a plan to the `stories` store ONLY after the learner confirms it (6.3);
 *     an unconfirmed plan is never written (the confirmation UI is the SetupScreen's StoryPlanReview).
 *   - generateChapter: generate one chapter by REUSING generationOrchestrator with a story
 *     consistency context (plot + prior-chapter summary) so characters/plot stay invariant (6.6).
 * Pure orchestration over injected ports; sequential chapter generation (no parallelism) so each
 * chapter can carry the previous chapter's summary.
 */

import { err, ok, type Result } from '../../types/result';
import type { GenerationOrchestrator, GenerationError } from '../generation/generationOrchestrator';
import type { StoryGateway, StoryRepository } from '../../types/ports';
import type {
  GenerationRequest,
  IndexedPassage,
  StoryContext,
  StoryPlan,
  StoryPlanRequest,
  UserId,
} from '../../types/domain';

export interface StoryPlanner {
  /** Generate a story plan (does NOT persist it — persistence is gated on confirmPlan). */
  planStory(req: StoryPlanRequest): Promise<Result<StoryPlan, GenerationError>>;
  /** Persist a learner-confirmed plan to the stories store (6.3). */
  confirmPlan(userId: UserId, plan: StoryPlan): Promise<void>;
  /** Generate one chapter's body, supplying the consistency context (6.6). */
  generateChapter(
    plan: StoryPlan,
    chapterIndex: number,
    base: GenerationRequest,
    priorSummaryJa?: string,
  ): Promise<Result<IndexedPassage, GenerationError>>;
}

export interface StoryPlannerDeps {
  gateway: StoryGateway;
  storyRepo: StoryRepository;
  /** Builds an orchestrator bound to a chapter passageId (defaults are provided by the container). */
  createOrchestrator?: (passageId: string) => GenerationOrchestrator;
  now?: () => number;
}

export function createStoryPlanner(deps: StoryPlannerDeps): StoryPlanner {
  const now = deps.now ?? (() => Date.now());

  async function planStory(req: StoryPlanRequest): Promise<Result<StoryPlan, GenerationError>> {
    try {
      const plan = await deps.gateway.planStory(req);
      return ok(plan);
    } catch {
      // Align with the generation error policy: no mock fallback, surface a refusal-style error.
      return err({ kind: 'refusal' });
    }
  }

  async function confirmPlan(userId: UserId, plan: StoryPlan): Promise<void> {
    await deps.storyRepo.put({ storyId: plan.storyId, userId, createdAt: now(), plan });
  }

  async function generateChapter(
    plan: StoryPlan,
    chapterIndex: number,
    base: GenerationRequest,
    priorSummaryJa?: string,
  ): Promise<Result<IndexedPassage, GenerationError>> {
    if (!deps.createOrchestrator) {
      return err({ kind: 'refusal' });
    }
    const storyContext: StoryContext = {
      storyId: plan.storyId,
      chapterIndex,
      plan, // same reference ⇒ characters/plot invariant across chapters
      ...(priorSummaryJa ? { priorSummaryJa } : {}),
    };
    const req: GenerationRequest = {
      ...base,
      contentType: plan.contentType,
      storyContext,
    };
    const orchestrator = deps.createOrchestrator(`${plan.storyId}:${chapterIndex}`);
    return orchestrator.generate(req);
  }

  return { planStory, confirmPlan, generateChapter };
}

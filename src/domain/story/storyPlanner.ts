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
  CharacterIllustrationRequest,
  GenerationRequest,
  IndexedPassage,
  StoryCharacter,
  StoryContext,
  StoryPlan,
  StoryPlanExtensionRequest,
  StoryPlanRequest,
  UserId,
} from '../../types/domain';

type CharacterIllustrationVariant = NonNullable<CharacterIllustrationRequest['variant']>;
type CharacterIllustrationPair = Pick<
  StoryCharacter,
  'illustrationUrl' | 'portraitIllustrationUrl' | 'fullBodyIllustrationUrl'
>;

export interface StoryPlanner {
  /** Generate a story plan (does NOT persist it — persistence is gated on confirmPlan). */
  planStory(req: StoryPlanRequest): Promise<Result<StoryPlan, GenerationError>>;
  /**
   * Enrich a plan with generated full-body and portrait images per character (6.8). Each character
   * is generated full-body first, then portrait, so the overview uses a real portrait instead of a
   * crop. Characters still run in PARALLEL and NEVER throw: a character whose image pair fails (or
   * when the gateway can't illustrate) is left without illustration fields. `onEach` fires as each
   * complete pair lands so the UI can reveal progressively. Returns a NEW plan (the input is not
   * mutated).
   */
  illustrateCharacters(
    plan: StoryPlan,
    onEach?: (index: number, illustrations: CharacterIllustrationPair) => void,
  ): Promise<StoryPlan>;
  /**
   * Regenerate one character illustration variant on demand. Defaults to the full-body variant; pass
   * `portrait` for a dedicated overview portrait. Returns null
   * when illustration is unavailable, the index is invalid, or the image provider fails; existing
   * stored art should be kept.
   */
  illustrateCharacter(
    plan: StoryPlan,
    characterIndex: number,
    variant?: CharacterIllustrationVariant,
  ): Promise<string | null>;
  /**
   * Regenerate both variants for one character. The full-body image is generated first; the portrait
   * is generated second and stored separately for overview pages.
   */
  illustrateCharacterPair(
    plan: StoryPlan,
    characterIndex: number,
  ): Promise<CharacterIllustrationPair | null>;
  /** Extend a long-story plan with more future chapter beats when the plot outline is exhausted. */
  extendPlan(
    plan: StoryPlan,
    nextChapterIndex: number,
    priorSummaryJa?: string,
  ): Promise<Result<StoryPlan, GenerationError>>;
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

  async function illustrateCharacters(
    plan: StoryPlan,
    onEach?: (index: number, illustrations: CharacterIllustrationPair) => void,
  ): Promise<StoryPlan> {
    const illustrate = deps.gateway.illustrateCharacter?.bind(deps.gateway);
    if (!illustrate) return plan; // enrichment unavailable — return the plan untouched
    const characters = plan.characters.map((c) => ({ ...c }));
    await Promise.allSettled(
      characters.map(async (_character, index) => {
        const illustrations = await illustrateCharacterPairInternal({ ...plan, characters }, index, illustrate);
        if (!illustrations) return;
        characters[index] = { ...characters[index]!, ...illustrations };
        onEach?.(index, illustrations);
      }),
    );
    return { ...plan, characters };
  }

  async function illustrateCharacter(
    plan: StoryPlan,
    characterIndex: number,
    variant: CharacterIllustrationVariant = 'full_body',
  ): Promise<string | null> {
    const illustrate = deps.gateway.illustrateCharacter?.bind(deps.gateway);
    if (!illustrate || !plan.characters[characterIndex]) return null;
    try {
      return await illustrate(characterIllustrationRequest(plan, characterIndex, variant));
    } catch {
      return null;
    }
  }

  async function illustrateCharacterPair(
    plan: StoryPlan,
    characterIndex: number,
  ): Promise<CharacterIllustrationPair | null> {
    const illustrate = deps.gateway.illustrateCharacter?.bind(deps.gateway);
    if (!illustrate || !plan.characters[characterIndex]) return null;
    return illustrateCharacterPairInternal(plan, characterIndex, illustrate);
  }

  async function confirmPlan(userId: UserId, plan: StoryPlan): Promise<void> {
    await deps.storyRepo.put({ storyId: plan.storyId, userId, createdAt: now(), plan });
  }

  async function extendPlan(
    plan: StoryPlan,
    nextChapterIndex: number,
    priorSummaryJa?: string,
  ): Promise<Result<StoryPlan, GenerationError>> {
    const extend = deps.gateway.extendStoryPlan?.bind(deps.gateway);
    if (!extend) return err({ kind: 'refusal' });
    const req: StoryPlanExtensionRequest = {
      plan,
      nextChapterIndex,
      ...(priorSummaryJa ? { priorSummaryJa } : {}),
      additionalChapters: 3,
    };
    try {
      const extended = await extend(req);
      return ok(extended);
    } catch {
      return err({ kind: 'refusal' });
    }
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
    const result = await orchestrator.generate(req);
    if (!result.ok) return result;
    return ok(attachStoryRef(result.value, storyContext));
  }

  return {
    planStory,
    illustrateCharacters,
    illustrateCharacter,
    illustrateCharacterPair,
    extendPlan,
    confirmPlan,
    generateChapter,
  };
}

async function illustrateCharacterPairInternal(
  plan: StoryPlan,
  characterIndex: number,
  illustrate: (req: CharacterIllustrationRequest) => Promise<string>,
): Promise<CharacterIllustrationPair | null> {
  try {
    const fullBodyIllustrationUrl = await illustrate(characterIllustrationRequest(plan, characterIndex, 'full_body'));
    const planWithFullBody: StoryPlan = {
      ...plan,
      characters: plan.characters.map((character, index) =>
        index === characterIndex ? { ...character, fullBodyIllustrationUrl } : character,
      ),
    };
    const portraitIllustrationUrl = await illustrate(
      characterIllustrationRequest(planWithFullBody, characterIndex, 'portrait'),
    );
    return {
      illustrationUrl: portraitIllustrationUrl,
      portraitIllustrationUrl,
      fullBodyIllustrationUrl,
    };
  } catch {
    return null;
  }
}

function characterIllustrationRequest(
  plan: StoryPlan,
  characterIndex: number,
  variant: CharacterIllustrationVariant,
): CharacterIllustrationRequest {
  const character = plan.characters[characterIndex]!;
  return {
    name: character.name,
    role: character.role,
    descriptionJa: character.descriptionJa,
    genre: plan.genre,
    variant,
    storyTitleJa: plan.titleJa,
    storySynopsisJa: plan.synopsisJa,
    castStyleGuide: castStyleGuide(plan.characters),
    styleHint: plan.homage?.styleNoteJa || plan.genre,
  };
}

function castStyleGuide(characters: StoryCharacter[]): string {
  return characters
    .map((character, index) => `${index + 1}. ${character.name} (${character.role}): ${character.descriptionJa}`)
    .join('\n');
}

function attachStoryRef(passage: IndexedPassage, storyContext: StoryContext): IndexedPassage {
  return {
    ...passage,
    source: {
      ...passage.source,
      meta: {
        ...passage.source.meta,
        storyRef: {
          storyId: storyContext.storyId,
          chapterIndex: storyContext.chapterIndex,
        },
      },
    },
  };
}

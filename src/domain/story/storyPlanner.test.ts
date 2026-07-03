import { describe, it, expect } from 'vitest';
import { createStoryPlanner } from './storyPlanner';
import type { GenerationOrchestrator } from '../generation/generationOrchestrator';
import type { StoryGateway, StoryRepository } from '../../types/ports';
import type {
  GenerationRequest,
  IndexedPassage,
  StoryPlan,
  StoryPlanRequest,
  StoryRecord,
  UserId,
} from '../../types/domain';
import { ok } from '../../types/result';

const U = 'u1' as UserId;

function plan(over: Partial<StoryPlan> = {}): StoryPlan {
  return {
    storyId: 's1',
    contentType: 'long_story',
    genre: 'fantasy',
    titleJa: '竜の物語',
    synopsisJa: '竜と少女の冒険。',
    characters: [{ name: 'Aria', role: 'hero', descriptionJa: '勇敢な少女' }],
    chapters: [
      { index: 0, headingJa: '第一章', beatJa: '出会い' },
      { index: 1, headingJa: '第二章', beatJa: '試練' },
    ],
    ...over,
  };
}

function gateway(planned: StoryPlan | (() => never)): { gw: StoryGateway; calls: () => StoryPlanRequest[] } {
  const seen: StoryPlanRequest[] = [];
  return {
    gw: {
      planStory: async (req) => {
        seen.push(req);
        if (typeof planned === 'function') return planned();
        return planned;
      },
    },
    calls: () => seen,
  };
}

/** In-memory StoryRepository. */
function memRepo(): StoryRepository & { rows: () => StoryRecord[] } {
  const map = new Map<string, StoryRecord>();
  return {
    get: async (id) => map.get(id),
    put: async (r) => void map.set(r.storyId, r),
    recent: async () => [...map.values()],
    rows: () => [...map.values()],
  };
}

const planReq: StoryPlanRequest = { contentType: 'long_story', genre: 'fantasy', intent: 'daily', level: 'B1' };

const baseGenReq: GenerationRequest = {
  level: 'B1',
  intent: 'daily',
  newWordRatio: 0.3,
  wordTarget: 800,
  contentType: 'long_story',
  targetWords: [],
};

describe('StoryPlanner.planStory (12.1)', () => {
  it('produces a plan with characters, synopsis and chapters via the gateway', async () => {
    const { gw, calls } = gateway(plan());
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });
    const result = await planner.planStory(planReq);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.characters.length).toBeGreaterThan(0);
      expect(result.value.synopsisJa).toBeTruthy();
      expect(result.value.chapters.length).toBeGreaterThan(0);
    }
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toEqual(planReq);
  });

  it('surfaces a generation error (no mock fallback) when the gateway throws', async () => {
    const { gw } = gateway(() => {
      throw new Error('503');
    });
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });
    const result = await planner.planStory(planReq);
    expect(result.ok).toBe(false);
  });

  it('does NOT persist the plan on generation (confirmation gate not yet passed, 12.2/6.3)', async () => {
    const repo = memRepo();
    const { gw } = gateway(plan());
    const planner = createStoryPlanner({ gateway: gw, storyRepo: repo });
    await planner.planStory(planReq);
    expect(repo.rows()).toHaveLength(0);
  });
});

describe('StoryPlanner.confirmPlan (12.2 — persistence gated on confirmation)', () => {
  it('persists the plan to the stories store only after explicit confirmation', async () => {
    const repo = memRepo();
    const planner = createStoryPlanner({ gateway: gateway(plan()).gw, storyRepo: repo, now: () => 42 });
    await planner.confirmPlan(U, plan());
    const rows = repo.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storyId: 's1', userId: U, createdAt: 42 });
    expect(rows[0]!.plan.titleJa).toBe('竜の物語');
  });
});

describe('StoryPlanner.illustrateCharacters (6.8 — parallel, progressive, never throws)', () => {
  const twoChars = (): StoryPlan =>
    plan({
      characters: [
        { name: 'Aria', role: 'hero', descriptionJa: '勇敢な少女' },
        { name: 'Draco', role: 'dragon', descriptionJa: '孤独な竜' },
      ],
    });

  function gatewayWithIllustrator(
    illustrate: (req: { name: string }) => Promise<string>,
  ): StoryGateway {
    return { planStory: async () => plan(), illustrateCharacter: (req) => illustrate(req) };
  }

  it('fills each character illustrationUrl and fires onEach per character', async () => {
    const gw = gatewayWithIllustrator(async (req) => `data:image/png;base64,${req.name}`);
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });
    const seen: Array<[number, string]> = [];
    const result = await planner.illustrateCharacters(twoChars(), (i, url) => seen.push([i, url]));

    expect(result.characters[0]!.illustrationUrl).toBe('data:image/png;base64,Aria');
    expect(result.characters[1]!.illustrationUrl).toBe('data:image/png;base64,Draco');
    expect(seen.sort()).toEqual([
      [0, 'data:image/png;base64,Aria'],
      [1, 'data:image/png;base64,Draco'],
    ]);
  });

  it('does not reject when one character fails — others keep their portraits', async () => {
    const gw = gatewayWithIllustrator(async (req) => {
      if (req.name === 'Aria') throw new Error('image API down');
      return `data:image/png;base64,${req.name}`;
    });
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });
    const result = await planner.illustrateCharacters(twoChars());

    expect(result.characters[0]!.illustrationUrl).toBeUndefined();
    expect(result.characters[1]!.illustrationUrl).toBe('data:image/png;base64,Draco');
  });

  it('returns the plan unchanged when the gateway cannot illustrate (enrichment skipped)', async () => {
    const planner = createStoryPlanner({ gateway: gateway(plan()).gw, storyRepo: memRepo() });
    const input = twoChars();
    const result = await planner.illustrateCharacters(input);
    expect(result.characters.every((c) => c.illustrationUrl === undefined)).toBe(true);
  });

  it('regenerates one character portrait on demand', async () => {
    const seen: unknown[] = [];
    const gw: StoryGateway = {
      planStory: async () => plan(),
      illustrateCharacter: async (req) => {
        seen.push(req);
        return `data:image/png;base64,${req.name}`;
      },
    };
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });

    const result = await planner.illustrateCharacter(twoChars(), 1);

    expect(result).toBe('data:image/png;base64,Draco');
    expect(seen[0]).toMatchObject({ name: 'Draco', role: 'dragon', genre: 'fantasy', styleHint: 'fantasy' });
  });

  it('returns null for single-portrait regeneration when illustration is unavailable or fails', async () => {
    const withoutIllustrator = createStoryPlanner({ gateway: gateway(plan()).gw, storyRepo: memRepo() });
    await expect(withoutIllustrator.illustrateCharacter(twoChars(), 0)).resolves.toBeNull();

    const failing = createStoryPlanner({
      gateway: gatewayWithIllustrator(async () => {
        throw new Error('image down');
      }),
      storyRepo: memRepo(),
    });
    await expect(failing.illustrateCharacter(twoChars(), 0)).resolves.toBeNull();
    await expect(failing.illustrateCharacter(twoChars(), 9)).resolves.toBeNull();
  });
});

describe('StoryPlanner.extendPlan (long-story plot continuation)', () => {
  it('extends the plan through the gateway when chapter beats are exhausted', async () => {
    const seen: unknown[] = [];
    const extended = plan({
      chapters: [
        { index: 0, headingJa: '第一章', beatJa: '出会い' },
        { index: 1, headingJa: '第二章', beatJa: '星の門へ進む' },
      ],
    });
    const gw: StoryGateway = {
      planStory: async () => plan(),
      extendStoryPlan: async (req) => {
        seen.push(req);
        return extended;
      },
    };
    const planner = createStoryPlanner({ gateway: gw, storyRepo: memRepo() });
    const result = await planner.extendPlan(plan({ chapters: [{ index: 0, headingJa: '第一章', beatJa: '出会い' }] }), 1, '第一章の要約');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chapters[1]!.beatJa).toContain('星の門');
    expect(seen[0]).toMatchObject({ nextChapterIndex: 1, priorSummaryJa: '第一章の要約', additionalChapters: 3 });
  });

  it('returns a generation error when the gateway cannot extend the plan', async () => {
    const planner = createStoryPlanner({ gateway: gateway(plan()).gw, storyRepo: memRepo() });
    const result = await planner.extendPlan(plan(), 2);
    expect(result.ok).toBe(false);
  });
});

describe('StoryPlanner.generateChapter (14.1 — sequential, consistency context)', () => {
  it('generates a chapter through the orchestrator with the plot + prior-summary story context', async () => {
    let capturedReq: GenerationRequest | null = null;
    const orchestrator: GenerationOrchestrator = {
      generate: async (req) => {
        capturedReq = req;
        return ok({
          passageId: 'p1',
          renderText: 'chapter text',
          sentences: [],
          tokens: [],
          source: {
            meta: { title: 't', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
            sentences: [],
            targetSpans: [],
            collocationSpans: [],
            noticeCues: [],
          },
        } as IndexedPassage);
      },
    };
    const planner = createStoryPlanner({
      gateway: gateway(plan()).gw,
      storyRepo: memRepo(),
      createOrchestrator: () => orchestrator,
    });
    const result = await planner.generateChapter(plan(), 1, baseGenReq, '前章の要約');
    expect(result.ok).toBe(true);
    expect(capturedReq).not.toBeNull();
    expect(capturedReq!.storyContext).toMatchObject({
      storyId: 's1',
      chapterIndex: 1,
      priorSummaryJa: '前章の要約',
    });
    // Same plan reference is supplied so characters/plot stay invariant across chapters.
    expect(capturedReq!.storyContext!.plan.titleJa).toBe('竜の物語');
    if (result.ok) {
      expect(result.value.source.meta.storyRef).toEqual({ storyId: 's1', chapterIndex: 1 });
    }
  });
});

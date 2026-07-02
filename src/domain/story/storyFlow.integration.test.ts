import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { createStoryPlanner } from './storyPlanner';
import { createGenerationOrchestrator } from '../generation/generationOrchestrator';
import { tokenizer } from '../tokenizer/joinService';
import type { ContentGateway, StoryGateway } from '../../types/ports';
import type {
  GenerationRequest,
  GenerationResponse,
  PassageOutput,
  StoryPlan,
  UserId,
} from '../../types/domain';

const U = 'story_user' as UserId;

const PLAN: StoryPlan = {
  storyId: 's1',
  contentType: 'long_story',
  genre: 'fantasy',
  homage: { title: 'A Study in Scarlet', styleNoteJa: '推理小説の作風' },
  titleJa: '竜の物語',
  synopsisJa: '竜と少女の冒険。',
  characters: [{ name: 'Aria', role: 'hero', descriptionJa: '勇敢な少女' }],
  chapters: [
    { index: 0, headingJa: '第一章', beatJa: '出会い' },
    { index: 1, headingJa: '第二章', beatJa: '試練' },
  ],
};

const storyGateway: StoryGateway = {
  planStory: async () => PLAN,
};

/** A filler passage large enough to clear the length gate for a modest wordTarget. */
function chapterPassage(chapterIndex: number): PassageOutput {
  const FILLER = ['The', 'hero', 'walked', 'on', 'through', 'the', 'quiet', 'land', '.'];
  return {
    meta: {
      title: `chapter ${chapterIndex}`,
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
      storyRef: { storyId: 's1', chapterIndex },
    },
    sentences: Array.from({ length: 12 }, () => ({ tokens: [...FILLER], translationJa: '英雄は静かな地を歩いた。' })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

function contentGateway(): ContentGateway {
  return {
    generatePassage: async (req: GenerationRequest): Promise<GenerationResponse> => {
      const chapterIndex = req.storyContext?.chapterIndex ?? 0;
      return { passage: chapterPassage(chapterIndex), stopReason: 'end_turn' };
    },
    getWordData: async () => {
      throw new Error('unused');
    },
  };
}

const baseReq: GenerationRequest = {
  level: 'B1',
  intent: 'daily',
  newWordRatio: 0.3,
  wordTarget: 100,
  contentType: 'long_story',
  targetWords: [],
};

describe('story flow integration (18.1 / 18.2): plan → confirm → chapters persisted', () => {
  it('persists the confirmed plan once and each chapter linked by storyRef, retrievable by storyId', async () => {
    const db = new LexiaDb(U);
    await db.open();
    const repos = createRepositories(db);

    const content = contentGateway();
    const planner = createStoryPlanner({
      gateway: storyGateway,
      storyRepo: repos.stories,
      createOrchestrator: (passageId) => createGenerationOrchestrator({ gateway: content, passageId }),
      now: () => 1000,
    });

    // 1. Plan — nothing persisted before confirmation (6.3).
    const planned = await planner.planStory({ contentType: 'long_story', genre: 'fantasy', intent: 'daily', level: 'B1' });
    expect(planned.ok).toBe(true);
    expect(await repos.stories.recent(U, 10)).toHaveLength(0);

    // 2. Confirm — the plan becomes the authoritative story record.
    const plan = planned.ok ? planned.value : PLAN;
    await planner.confirmPlan(U, plan);
    const stories = await repos.stories.recent(U, 10);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.plan.titleJa).toBe('竜の物語');

    // 3. Generate each chapter sequentially, supplying the prior-chapter summary, and persist with storyRef.
    let priorSummary: string | undefined;
    for (const chapter of plan.chapters) {
      const result = await planner.generateChapter(plan, chapter.index, baseReq, priorSummary);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const indexed = result.value;
      await repos.passages.put({
        passageId: `${plan.storyId}:${chapter.index}`,
        userId: U,
        createdAt: 1000 + chapter.index,
        passage: indexed.source,
      });
      priorSummary = `chapter ${chapter.index} summary`;
    }

    // 4. Both chapters persisted, linked to the story, retrievable via the storyRef index.
    const recent = await repos.passages.recent(U, 10);
    expect(recent).toHaveLength(2);
    const byStory = await db.passages.where('passage.meta.storyRef.storyId').equals('s1').toArray();
    expect(byStory).toHaveLength(2);
    expect(byStory.map((p) => p.passage.meta.storyRef?.chapterIndex).sort()).toEqual([0, 1]);
    db.close();
  });

  it('supplies each chapter the plot + prior-chapter summary (consistency context, 6.6)', async () => {
    const db = new LexiaDb('story_user2' as UserId);
    await db.open();
    const repos = createRepositories(db);
    const captured: { chapterIndex: number; priorSummaryJa?: string; title: string }[] = [];
    const content: ContentGateway = {
      generatePassage: async (req) => {
        captured.push({
          chapterIndex: req.storyContext?.chapterIndex ?? -1,
          priorSummaryJa: req.storyContext?.priorSummaryJa,
          title: req.storyContext?.plan.titleJa ?? '',
        });
        return { passage: chapterPassage(req.storyContext?.chapterIndex ?? 0), stopReason: 'end_turn' };
      },
      getWordData: async () => {
        throw new Error('unused');
      },
    };
    const planner = createStoryPlanner({
      gateway: storyGateway,
      storyRepo: repos.stories,
      createOrchestrator: (passageId) => createGenerationOrchestrator({ gateway: content, passageId }),
    });

    await planner.generateChapter(PLAN, 0, baseReq, undefined);
    await planner.generateChapter(PLAN, 1, baseReq, 'chapter 0 summary');

    expect(captured[0]).toMatchObject({ chapterIndex: 0, title: '竜の物語' });
    expect(captured[0]!.priorSummaryJa).toBeUndefined();
    expect(captured[1]).toMatchObject({ chapterIndex: 1, priorSummaryJa: 'chapter 0 summary' });
    db.close();
    void tokenizer; // (ensures the deterministic tokenizer import is exercised)
  });
});

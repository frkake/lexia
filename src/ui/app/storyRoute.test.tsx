// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type * as FeatureFlagsModule from './featureFlags';
import type { FeatureFlags } from './featureFlags';

// Enable the story cluster for this route test (default-off in production).
vi.mock('./featureFlags', async () => {
  const actual = await vi.importActual<typeof FeatureFlagsModule>('./featureFlags');
  return {
    ...actual,
    resolveFeatureFlags: (overrides?: Partial<FeatureFlags>) =>
      actual.resolveFeatureFlags({ storyMode: true, ...overrides }),
  };
});

import { appRoutes } from '../router';
import { AppProvider } from './AppContext';
import { createContainer, degradingTts } from './container';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { isImageRef } from '../../infra/persistence/imageStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { createSessionStore } from '../../state/stores/sessionStore';
import { createSettingsStore } from '../../state/stores/settingsStore';
import { generationProgressStore } from '../../state/stores/generationProgressStore';
import type { ContentGateway, StoryGateway } from '../../types/ports';
import type { GenerationRequest, PassageOutput, StoryPlan, UserId } from '../../types/domain';

const PLAN: StoryPlan = {
  storyId: 'story_1',
  contentType: 'short_story',
  genre: 'fantasy',
  titleJa: '星の少女',
  synopsisJa: '少女が星を探す短い物語。',
  characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
  chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
};

const PLAN_TWO: StoryPlan = {
  ...PLAN,
  storyId: 'story_2',
  titleJa: '月の少年',
  synopsisJa: '少年が月を探す短い物語。',
  characters: [{ name: 'Noa', role: '主人公', descriptionJa: '慎重な少年' }],
};

const LONG_PLAN: StoryPlan = {
  ...PLAN,
  contentType: 'long_story',
  synopsisJa: '少女が星を探す長い旅。',
  chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
};

const FILLER = ['She', 'walked', 'under', 'the', 'bright', 'night', 'sky', 'alone', '.'];
function chapterPassage(chapterIndex = 0, title = '星の少女 第一章'): PassageOutput {
  return {
    meta: {
      title,
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
      storyRef: { storyId: 'story_1', chapterIndex },
    },
    // ~40 sentences × 8 words ≈ 320 words, comfortably inside the default 400-word target's band.
    sentences: Array.from({ length: 40 }, () => ({ tokens: [...FILLER], translationJa: '彼女は夜空の下を歩いた。' })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

const storyGateway: StoryGateway = {
  planStory: async () => PLAN,
  illustrateCharacter: async (req) => `data:image/png;base64,${Buffer.from(`${req.name}-${req.variant}`).toString('base64')}`,
};
const contentGateway: ContentGateway = {
  generatePassage: async () => ({ passage: chapterPassage(), stopReason: 'end_turn' }),
  getWordData: async () => {
    throw new Error('unused');
  },
  suggestWords: async () => [],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('story flow through the real Setup route (6.3 gate → chapter, 18.3)', () => {
  // The generationProgressStore is an app-wide singleton (D-7). A test that ends on Home with a failed
  // generation leaves it in the `error` phase (the Home SetupScreen panel owns that error), which would
  // otherwise hide the 「文章を生成する」button in the next test. Reset it between tests for isolation.
  beforeEach(() => {
    generationProgressStore.getState().reset();
  });

  it('shows the plan-confirm gate for a story and generates a chapter only after confirmation', async () => {
    const userId = 'story_route_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const settings = createSettingsStore();
    const container = await createContainer(userId, {
      db,
      content: contentGateway,
      story: storyGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    // Pick a story content type, then generate → plan gate appears (no chapter yet).
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('content-type-short_story'));
    fireEvent.click(screen.getByText('文章を生成する'));

    // The confirmation gate is shown; no passage has been persisted yet (6.3).
    expect(await screen.findByText('星の少女')).toBeTruthy();
    expect(await screen.findByText('この設定で執筆する')).toBeTruthy();
    expect(await createRepositories(db).passages.recent(userId, 5)).toHaveLength(0);
    // The plan is not persisted until confirmation either.
    expect(await createRepositories(db).stories.recent(userId, 5)).toHaveLength(0);

    // The generated portrait streams in and is displayed on the confirmation gate (6.8).
    const characterImage = (await screen.findByAltText('Mia')) as HTMLImageElement;
    expect(characterImage.src).toContain('data:image/png;base64,');

    // Confirm → chapter is generated, persisted with the story link, and we land on Reading.
    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'), { timeout: 5_000 });
    await waitFor(async () => {
      const stories = await createRepositories(db).stories.recent(userId, 5);
      expect(stories).toHaveLength(1);
      // The generated portrait and full-body images persist separately with the confirmed plan (6.8).
      expect(stories[0]!.plan.characters[0]!.illustrationUrl).toContain('data:image/png;base64,');
      expect(stories[0]!.plan.characters[0]!.portraitIllustrationUrl).toContain('data:image/png;base64,');
      expect(stories[0]!.plan.characters[0]!.fullBodyIllustrationUrl).toContain('data:image/png;base64,');
      expect(stories[0]!.plan.characters[0]!.portraitIllustrationUrl).not.toBe(
        stories[0]!.plan.characters[0]!.fullBodyIllustrationUrl,
      );
      const passages = await createRepositories(db).passages.recent(userId, 5);
      expect(passages).toHaveLength(1);
      expect(passages[0]!.passage.meta.storyRef?.storyId).toBe('story_1');
    }, { timeout: 5_000 });

    fireEvent.click(await screen.findByTestId('story-settings', {}, { timeout: 5_000 }));
    expect(await screen.findByRole('dialog', { name: '物語設定' })).toBeTruthy();
    expect(screen.getByText('キャラクター設定')).toBeTruthy();
    expect(screen.getByText('Mia')).toBeTruthy();
    expect(screen.getByText('少女が星を探す短い物語。')).toBeTruthy();
  }, 10_000);

  it('shows body-generation errors on the story confirmation gate', async () => {
    const userId = 'story_route_confirm_error_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const failingContent: ContentGateway = {
      generatePassage: async () => ({ passage: chapterPassage(), stopReason: 'max_tokens' }),
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => [],
    };
    const settings = createSettingsStore();
    const container = await createContainer(userId, {
      db,
      content: failingContent,
      story: storyGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('content-type-short_story'));
    fireEvent.click(screen.getByText('文章を生成する'));
    fireEvent.click(await screen.findByText('この設定で執筆する'));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '文章が長すぎて生成が途中で止まりました。文章の長さを短くしてください。',
    );
    expect(screen.getByText('この設定で執筆する')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });

  it('regenerates one pending character as full-body first, then a dedicated portrait before persistence', async () => {
    const userId = 'story_route_regen_pending_pair_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let illustrationCalls = 0;
    let regeneratedDescription = '';
    const variants: Array<string | undefined> = [];
    const regeneratingStoryGateway: StoryGateway = {
      planStory: async () => PLAN,
      illustrateCharacter: async (req) => {
        illustrationCalls += 1;
        variants.push(req.variant);
        if (illustrationCalls >= 3) regeneratedDescription = req.descriptionJa;
        if (illustrationCalls === 1) return 'data:image/png;base64,OLDFULL';
        if (illustrationCalls === 2) return 'data:image/png;base64,OLDPORTRAIT';
        if (illustrationCalls === 3) return 'data:image/png;base64,NEWFULL';
        return 'data:image/png;base64,NEWPORTRAIT';
      },
    };
    const container = await createContainer(userId, {
      db,
      content: contentGateway,
      story: regeneratingStoryGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings: createSettingsStore(),
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('content-type-short_story'));
    fireEvent.click(screen.getByText('文章を生成する'));
    expect(((await screen.findByAltText('Mia')) as HTMLImageElement).src).toContain('OLDPORTRAIT');

    await act(async () => {
      fireEvent.click(screen.getByTestId('character-description-display-0'));
    });
    fireEvent.change(await screen.findByLabelText('Miaの説明'), { target: { value: '青い外套と星形の杖を持つ少女' } });
    fireEvent.click(screen.getByTestId('regenerate-character-portrait-0'));
    await waitFor(() => expect((screen.getByAltText('Mia') as HTMLImageElement).src).toContain('NEWPORTRAIT'));
    expect(regeneratedDescription).toBe('青い外套と星形の杖を持つ少女');
    expect(variants).toEqual(['full_body', 'portrait', 'full_body', 'portrait']);

    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'), { timeout: 5_000 });
    await waitFor(async () => {
      const stories = await createRepositories(db).stories.recent(userId, 5);
      expect(stories[0]!.plan.characters[0]!.illustrationUrl).toBe('data:image/png;base64,NEWPORTRAIT');
      expect(stories[0]!.plan.characters[0]!.portraitIllustrationUrl).toBe('data:image/png;base64,NEWPORTRAIT');
      expect(stories[0]!.plan.characters[0]!.fullBodyIllustrationUrl).toBe('data:image/png;base64,NEWFULL');
    });
  }, 10_000);

  it('opens an individual character detail page and generates the full-body illustration', async () => {
    const userId = 'story_route_character_detail_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.stories.put({
      storyId: PLAN.storyId,
      userId,
      createdAt: 1_000,
      plan: {
        ...PLAN,
        characters: [
          {
            ...PLAN.characters[0]!,
            illustrationUrl: 'data:image/png;base64,UE9SVFJBSVQ=',
            portraitIllustrationUrl: 'data:image/png;base64,UE9SVFJBSVQ=',
          },
        ],
      },
    });

    const variants: Array<string | undefined> = [];
    const detailStoryGateway: StoryGateway = {
      planStory: async () => PLAN,
      illustrateCharacter: async (req) => {
        variants.push(req.variant);
        return req.variant === 'full_body'
          ? 'data:image/png;base64,RlVMTEJPRFk='
          : 'data:image/png;base64,UE9SVFJBSVQy';
      },
    };
    const container = await createContainer(userId, {
      db,
      content: contentGateway,
      story: detailStoryGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings: createSettingsStore(),
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/s/story_1/characters/0'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Mia' })).toBeTruthy();
    await waitFor(() => expect((screen.getByAltText('Mia の全身') as HTMLImageElement).src).toContain('RlVMTEJPRFk='));
    expect(variants).toEqual(['full_body', 'portrait']);
    await waitFor(async () => {
      const story = await repos.stories.get('story_1');
      expect(story?.plan.characters[0]!.fullBodyIllustrationUrl).toBe('data:image/png;base64,RlVMTEJPRFk=');
      expect(story?.plan.characters[0]!.portraitIllustrationUrl).toBe('data:image/png;base64,UE9SVFJBSVQy');
    });
  });

  it('keeps the current plan illustrating when an older character image request finishes after regenerate', async () => {
    const userId = 'story_route_race_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const firstPortrait = deferred<string>();
    const secondPortrait = deferred<string>();
    const plans = [PLAN, PLAN_TWO];
    const racingStoryGateway: StoryGateway = {
      planStory: async () => plans.shift() ?? PLAN_TWO,
      illustrateCharacter: vi
        .fn()
        .mockImplementationOnce(() => firstPortrait.promise)
        .mockImplementationOnce(() => secondPortrait.promise),
    };

    const settings = createSettingsStore();
    const container = await createContainer(userId, {
      db,
      content: contentGateway,
      story: racingStoryGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('content-type-short_story'));
    fireEvent.click(screen.getByText('文章を生成する'));
    expect(await screen.findByText('星の少女')).toBeTruthy();
    expect(screen.getByTestId('character-portrait-loading')).toBeTruthy();

    fireEvent.click(screen.getByText('やり直す'));
    fireEvent.click(await screen.findByText('文章を生成する'));
    expect(await screen.findByText('月の少年')).toBeTruthy();
    expect(screen.getByTestId('character-portrait-loading')).toBeTruthy();

    await act(async () => {
      firstPortrait.resolve('data:image/png;base64,old');
      await firstPortrait.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText('月の少年')).toBeTruthy();
    expect(screen.getByTestId('character-portrait-loading')).toBeTruthy();
    expect(screen.queryByTestId('character-portrait-placeholder')).toBeNull();
    expect(screen.queryByAltText('Mia')).toBeNull();
  });

  it('generates the next long-story chapter and extends the plot when chapter beats run out', async () => {
    const userId = 'story_route_continue_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.stories.put({ storyId: LONG_PLAN.storyId, userId, createdAt: 1_000, plan: LONG_PLAN });
    await repos.passages.put({
      passageId: 'story_1:0',
      userId,
      createdAt: 1_000,
      passage: chapterPassage(0, '星の少女 第一章'),
    });

    let capturedReq: GenerationRequest | null = null;
    const continuingContent: ContentGateway = {
      generatePassage: async (req) => {
        capturedReq = req;
        return { passage: chapterPassage(req.storyContext?.chapterIndex ?? 0, '星の少女 第二章'), stopReason: 'end_turn' };
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => [],
    };
    const extendingStory: StoryGateway = {
      planStory: async () => LONG_PLAN,
      extendStoryPlan: async (req) => ({
        ...req.plan,
        synopsisJa: '少女は星の門の向こうへ旅を続ける。',
        chapters: [
          ...req.plan.chapters,
          { index: req.nextChapterIndex, headingJa: '第二章', beatJa: '星の門を開く' },
        ],
      }),
    };
    const session = createSessionStore();
    session.getState().startPassage(tokenizer.index('story_1:0', chapterPassage(0, '星の少女 第一章')), 1_000);
    const container = await createContainer(userId, {
      db,
      content: continuingContent,
      story: extendingStory,
      tts: degradingTts,
      now: () => 2_000,
      settings: createSettingsStore(),
      session,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/s/story_1/0'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('続きを生成')).toBeTruthy();
    fireEvent.click(screen.getByText('続きを生成'));

    await waitFor(() => expect(screen.getAllByText('星の少女 第二章').length).toBeGreaterThan(0));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/1'));
    const reqSeen = capturedReq as unknown as GenerationRequest;
    expect(reqSeen.storyContext).toMatchObject({ storyId: 'story_1', chapterIndex: 1 });
    expect(reqSeen.storyContext?.priorSummaryJa).toContain('星の少女 第一章');
    const storedStory = await repos.stories.get('story_1');
    expect(storedStory?.plan.chapters.map((chapter) => chapter.index)).toEqual([0, 1]);
    const passages = await repos.passages.byStory(userId, 'story_1');
    expect(passages.map((p) => p.passage.meta.storyRef?.chapterIndex)).toEqual([0, 1]);
  });

  it('re-selects a continuing chapter\'s words, avoiding earlier chapters but letting due words reappear (A-1-4)', async () => {
    const userId = 'story_route_reselect_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    const now = 5_000_000;
    await repos.stories.put({ storyId: LONG_PLAN.storyId, userId, createdAt: 1_000, plan: LONG_PLAN });
    // Chapter 0 wove in two words: 'ancient' (never reviewed) and 'reviewed' (a due review word).
    const chapterZero: PassageOutput = {
      ...chapterPassage(0, '星の少女 第一章'),
      targetSpans: [
        { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1, wordId: 'ancient', surface: 'ancient', masteryDensity: 'new' },
        { sentenceIndex: 1, tokenStart: 0, tokenEnd: 1, wordId: 'reviewed', surface: 'reviewed', masteryDensity: 'review' },
      ],
    };
    await repos.passages.put({ passageId: 'story_1:0', userId, createdAt: 1_000, passage: chapterZero });
    // 'reviewed' has been learned (stability set) and is due now → it may reappear across chapters.
    await repos.scheduling.upsert({
      userId,
      wordId: 'reviewed',
      level: 'B1',
      stability: 12,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: now - 100,
      dueAt: now - 1,
      lastSource: 'review',
      mastery: 'Consolidating',
      reappearCount: 1,
    });

    let capturedReq: GenerationRequest | null = null;
    let capturedExclude: string[] = [];
    const reselectingContent: ContentGateway = {
      generatePassage: async (req) => {
        capturedReq = req;
        return { passage: chapterPassage(1, '星の少女 第二章'), stopReason: 'end_turn' };
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async ({ exclude }) => {
        capturedExclude = [...(exclude ?? [])];
        return ['brandnew'];
      },
    };
    const session = createSessionStore();
    session.getState().startPassage(tokenizer.index('story_1:0', chapterZero), now);
    const settings = createSettingsStore();
    // A home generation left a manual word behind; it must NOT bleed into the story continuation.
    settings.getState().setLastSetup({
      examTarget: { kind: 'eiken', value: '2' },
      intent: 'daily',
      newWordRatio: 0.3,
      wordTarget: 400,
      contentType: 'long_story',
      targetWordIds: ['legacy'],
      excludedWordIds: [],
    });
    const container = await createContainer(userId, {
      db,
      content: reselectingContent,
      story: { planStory: async () => LONG_PLAN, extendStoryPlan: async (req) => ({ ...req.plan }) },
      tts: degradingTts,
      now: () => now,
      settings,
      session,
    });
    const twoChapterPlan: StoryPlan = {
      ...LONG_PLAN,
      chapters: [
        { index: 0, headingJa: '第一章', beatJa: '旅立ち' },
        { index: 1, headingJa: '第二章', beatJa: '星の門' },
      ],
    };
    await repos.stories.put({ storyId: twoChapterPlan.storyId, userId, createdAt: 1_000, plan: twoChapterPlan });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/s/story_1/0'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('続きを生成')).toBeTruthy();
    fireEvent.click(screen.getByText('続きを生成'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/1'), { timeout: 5_000 });

    const wovenIds = (capturedReq as unknown as GenerationRequest).targetWords.map((w) => w.wordId);
    // The review-due 'reviewed' reappears; a freshly-suggested word joins it …
    expect(wovenIds).toContain('reviewed');
    expect(wovenIds).toContain('brandnew');
    // … the earlier chapter's never-reviewed 'ancient' is NOT re-woven …
    expect(wovenIds).not.toContain('ancient');
    // … and the home setup's manual word never contaminates the continuation (targetWordIds reset).
    expect(wovenIds).not.toContain('legacy');
    // The avoid list also reaches the LLM new-word exclusion so it never re-proposes 'ancient'.
    expect(capturedExclude).toContain('ancient');
  });

  it('advances the URL to an already-generated next chapter without regenerating', async () => {
    const userId = 'story_route_existing_next_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    const twoChapterPlan: StoryPlan = {
      ...LONG_PLAN,
      chapters: [
        { index: 0, headingJa: '第一章', beatJa: '旅立ち' },
        { index: 1, headingJa: '第二章', beatJa: '星の門' },
      ],
    };
    await repos.stories.put({ storyId: twoChapterPlan.storyId, userId, createdAt: 1_000, plan: twoChapterPlan });
    await repos.passages.put({ passageId: 'story_1:0', userId, createdAt: 1_000, passage: chapterPassage(0, '星の少女 第一章') });
    await repos.passages.put({ passageId: 'story_1:1', userId, createdAt: 1_100, passage: chapterPassage(1, '星の少女 第二章') });

    let generateCalls = 0;
    const noRegenContent: ContentGateway = {
      generatePassage: async () => {
        generateCalls += 1;
        return { passage: chapterPassage(1, '星の少女 第二章'), stopReason: 'end_turn' };
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => [],
    };
    const session = createSessionStore();
    session.getState().startPassage(tokenizer.index('story_1:0', chapterPassage(0, '星の少女 第一章')), 1_000);
    const container = await createContainer(userId, {
      db,
      content: noRegenContent,
      story: { planStory: async () => twoChapterPlan },
      tts: degradingTts,
      now: () => 2_000,
      settings: createSettingsStore(),
      session,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/s/story_1/0'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('続きを生成')).toBeTruthy();
    fireEvent.click(screen.getByText('続きを生成'));

    // The already-generated chapter opens AND the address bar advances to it (URL/content stay in sync).
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/1'));
    await waitFor(() => expect(screen.getAllByText('星の少女 第二章').length).toBeGreaterThan(0));
    // No regeneration happened — the existing chapter was reused.
    expect(generateCalls).toBe(0);
    // The player resets to 'idle' (playable bar, ▶ synthesizes lazily) instead of the old
    // 'unavailable' hide — no audio is persisted for a revisited chapter.
    await waitFor(() => expect(container.player.getState().status).toBe('idle'));
    expect(container.player.getState().loadedPassageId).toBeNull();
  });

  it('persists character images that finish AFTER confirmation instead of discarding them (E-3(d))', async () => {
    const userId = 'story_route_confirm_race_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);

    // The full-body image for the (only) character is held until AFTER we confirm the plan — so the
    // confirmed story is first written WITHOUT the pair, mirroring "執筆開始 pressed before art is done".
    const fullBody = deferred<string>();
    const portraitData = `data:image/png;base64,${Buffer.from('mia-portrait').toString('base64')}`;
    const fullBodyData = `data:image/png;base64,${Buffer.from('mia-fullbody').toString('base64')}`;
    let illustrationCalls = 0;
    const racingStoryGateway: StoryGateway = {
      planStory: async () => PLAN,
      illustrateCharacter: async (req) => {
        illustrationCalls += 1;
        if (req.variant === 'full_body') return fullBody.promise;
        return portraitData;
      },
    };
    const container = await createContainer(userId, {
      db,
      content: contentGateway,
      story: racingStoryGateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings: createSettingsStore(),
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('content-type-short_story'));
    fireEvent.click(screen.getByText('文章を生成する'));

    // The gate is up while the character's full-body art is still generating (portrait not reached yet).
    expect(await screen.findByText('星の少女')).toBeTruthy();
    expect(screen.getByTestId('character-portrait-loading')).toBeTruthy();

    // Confirm early → the story is persisted WITHOUT the character illustration (still in flight).
    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'), { timeout: 5_000 });
    await waitFor(async () => expect(await repos.stories.get('story_1')).toBeDefined());
    expect((await repos.stories.get('story_1'))?.plan.characters[0]!.fullBodyIllustrationUrl).toBeUndefined();

    // Now the art finishes. E-3(d): it is saved onto the confirmed story (via the images table),
    // rather than being dropped by the (dismissed) confirmation gate.
    await act(async () => {
      fullBody.resolve(fullBodyData);
      await fullBody.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(async () => {
      const character = (await repos.stories.get('story_1'))!.plan.characters[0]!;
      expect(isImageRef(character.fullBodyIllustrationUrl)).toBe(true);
      expect(isImageRef(character.portraitIllustrationUrl)).toBe(true);
      expect(character.fullBodyIllustrationUrl).not.toBe(character.portraitIllustrationUrl);
    }, { timeout: 5_000 });
    // The bytes landed in the images table (portrait + full-body = 2 rows), not inline on the record.
    expect(await repos.images.all(userId)).toHaveLength(2);

    // Acceptance: opening the character detail page does NOT auto-regenerate — the stored pair is
    // complete, so no further image calls are made (only the original full_body + portrait ran).
    const callsAfterSave = illustrationCalls;
    expect(callsAfterSave).toBe(2);
    await act(async () => {
      await router.navigate('/s/story_1/characters/0');
    });
    expect(await screen.findByRole('heading', { name: 'Mia' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(illustrationCalls).toBe(callsAfterSave);
  });
});

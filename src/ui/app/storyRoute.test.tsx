// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
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
import { tokenizer } from '../../domain/tokenizer/joinService';
import { createSessionStore } from '../../state/stores/sessionStore';
import { createSettingsStore } from '../../state/stores/settingsStore';
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
  illustrateCharacter: async (req) => `data:image/png;base64,${Buffer.from(req.name).toString('base64')}`,
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

    // The character portrait streams in and is displayed on the confirmation gate (6.8).
    const portrait = (await screen.findByAltText('Mia')) as HTMLImageElement;
    expect(portrait.src).toContain('data:image/png;base64,');

    // Confirm → chapter is generated, persisted with the story link, and we land on Reading.
    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'), { timeout: 5_000 });
    await waitFor(async () => {
      const stories = await createRepositories(db).stories.recent(userId, 5);
      expect(stories).toHaveLength(1);
      // The generated illustration persists with the confirmed plan (6.8).
      expect(stories[0]!.plan.characters[0]!.illustrationUrl).toContain('data:image/png;base64,');
      const passages = await createRepositories(db).passages.recent(userId, 5);
      expect(passages).toHaveLength(1);
      expect(passages[0]!.passage.meta.storyRef?.storyId).toBe('story_1');
    }, { timeout: 5_000 });

    fireEvent.click(await screen.findByTestId('story-settings', {}, { timeout: 5_000 }));
    expect(await screen.findByRole('dialog', { name: '物語設定' })).toBeTruthy();
    expect(screen.getByText('キャラクター設定')).toBeTruthy();
    expect(screen.getByText('Mia')).toBeTruthy();
    expect(screen.getByText('少女が星を探す短い物語。')).toBeTruthy();
  });

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

  it('regenerates one pending character portrait before the story plan is persisted', async () => {
    const userId = 'story_route_regen_pending_portrait_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let portraitCalls = 0;
    const regeneratingStoryGateway: StoryGateway = {
      planStory: async () => PLAN,
      illustrateCharacter: async () => {
        portraitCalls += 1;
        return portraitCalls === 1 ? 'data:image/png;base64,OLDPORTRAIT' : 'data:image/png;base64,NEWPORTRAIT';
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

    fireEvent.click(screen.getByTestId('regenerate-character-portrait-0'));
    await waitFor(() => expect((screen.getByAltText('Mia') as HTMLImageElement).src).toContain('NEWPORTRAIT'));

    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'), { timeout: 5_000 });
    await waitFor(async () => {
      const stories = await createRepositories(db).stories.recent(userId, 5);
      expect(stories[0]!.plan.characters[0]!.illustrationUrl).toBe('data:image/png;base64,NEWPORTRAIT');
    });
  });

  it('keeps the current plan illustrating when an older portrait request finishes after regenerate', async () => {
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
  });
});

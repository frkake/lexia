// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { appRoutes } from '../router';
import { AppProvider } from './AppContext';
import { createContainer, degradingTts } from './container';
import { HttpContentGateway } from '../../infra/content/contentGatewayHttp';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { createPlayerStore } from '../../state/stores/playerStore';
import { createSessionStore } from '../../state/stores/sessionStore';
import { createSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import type { ContentGateway } from '../../types/ports';
import type { PassageOutput, UserId, WordData, WordSchedulingState } from '../../types/domain';

const wordData: WordData = {
  wordId: 'deal',
  headword: 'deal',
  ipa: '/diːl/',
  pos: ['noun'],
  register: 'neutral',
  connotation: '肯定的',
  frequency: 4,
  memoryTips: [{ kind: 'collocation', tipJa: 'close a deal の形で「取引をまとめる」と覚える。' }],
  core: {
    meaningsJa: ['取引'],
    examples: [{ en: 'The team closed the deal before noon.', ja: 'チームは正午前に取引を成立させた。' }],
    collocations: ['close a deal'],
    synonymNuances: ['agreement より商取引の響きが強い。'],
  },
};

// A simple 8-word filler sentence, repeated so the passage clears the length gate for `length: 'medium'`.
const FILLER = ['They', 'met', 'again', 'and', 'talked', 'for', 'a', 'while', '.'];

function validPassage(): PassageOutput {
  return {
    meta: { title: '取引の成立', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 245 },
    sentences: [
      { tokens: ['We', 'closed', 'the', 'deal', 'today', '.'], translationJa: '今日、取引を成立させた。' },
      ...Array.from({ length: 30 }, () => ({ tokens: [...FILLER], translationJa: '彼らは再び会って話した。' })),
    ],
    targetSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'deal', surface: 'deal', masteryDensity: 'new' }],
    collocationSpans: [],
    noticeCues: [],
  };
}

function sched(userId: UserId): WordSchedulingState {
  return {
    userId,
    wordId: 'deal',
    stability: 4,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
  };
}

describe('route wiring (tasks 10.1 / 10.4 through the real screens)', () => {
  it('Setup generates a passage and navigates into Reading (audio degrades, text continues)', async () => {
    const userId = 'route_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    await createRepositories(db).scheduling.upsert(sched(userId)); // seeds a Setup candidate

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    // No TTS backend → the port degrades; reading must still work.
    const container = await createContainer(userId, {
      db,
      content: gateway,
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

    // Setup screen mounts (real screen, not a placeholder) — the heading, not the nav link.
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    // The seeded candidate appears as a target chip.
    await screen.findByTestId('target-deal');

    fireEvent.click(screen.getByText('文章を生成する'));

    // Pipeline persisted the passage and the route navigated into Reading
    // (the title renders in both the mobile header and the main column).
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0));
    // Player degraded (no TTS backend) but the passage is on screen and lookup-able.
    await waitFor(() => expect(container.player.getState().status).toBe('unavailable'));
    expect(await createRepositories(db).passages.recent(userId, 5)).toHaveLength(1);

    fireEvent.click(await screen.findByText('読了として記録'));
    await waitFor(async () => {
      const progress = await createRepositories(db).progress.get(userId, container.session.getState().passage!.passageId);
      expect(progress?.status).toBe('completed');
    });
    const log = await createRepositories(db).reviewLog.since(userId, 0);
    expect(log.some((entry) => entry.wordId === 'deal' && entry.source === 'passage')).toBe(true);
  });

  it('renders the new 3-zone reading layout (grid + right-cell translation) through the real route', async () => {
    const userId = 'route_layout_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    await createRepositories(db).scheduling.upsert(sched(userId));

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    // ReadingScreen reads the SINGLETON settings store for translationMode, so set 全文 there to
    // make the right-cell Japanese visible (restored after the test).
    const prevMode = settingsStore.getState().translationMode;
    act(() => settingsStore.getState().setTranslationMode('full'));
    const container = await createContainer(userId, {
      db,
      content: gateway,
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
    fireEvent.click(screen.getByText('文章を生成する'));
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0));

    // The reading body is the sentence-unit grid (not flowing prose) …
    await waitFor(() => expect(screen.getByTestId('passage-prose').getAttribute('data-layout')).toBe('grid'));
    // … the first sentence's Japanese sits in its right cell …
    expect(screen.getByTestId('sentence-aside-0').textContent).toContain('今日、取引を成立させた。');
    // … and exactly one notice rail is rendered (owned, anchor-aware — not duplicated by the route).
    expect(screen.getAllByText('この文章で気づきたいこと')).toHaveLength(1);

    act(() => settingsStore.getState().setTranslationMode(prevMode)); // restore for sibling tests
  });

  it('auto-proposes new words when none are selected, weaving + seeding them into the SRS', async () => {
    const userId = 'route_auto_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    // No seeded scheduling → the Setup screen has no candidates → targetWordIds is empty.

    let suggestCalls = 0;
    const gateway: ContentGateway = {
      async suggestWords() {
        suggestCalls += 1;
        return ['deal'];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    // Fresh settings store → lastSetup stays at the default (level B1, no target words), isolated
    // from the singleton mutated by the sibling test above.
    const container = await createContainer(userId, {
      db,
      content: gateway,
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

    // Level defaults to B1 (lastSetup), so generation is allowed with zero hand-picked words.
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByText('文章を生成する'));

    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0));
    // Suggestion is consulted (on setup open for the initial candidates and/or at generate time).
    expect(suggestCalls).toBeGreaterThanOrEqual(1);
    // The auto-proposed word is woven in AND tracked in the SRS so it can reappear later.
    await waitFor(async () => {
      const seeded = await createRepositories(db).scheduling.get(userId, 'deal');
      expect(seeded).toBeDefined();
    });
  });

  it('enriches the live Review route with WordData and caches it for the wordbook', async () => {
    const userId = 'route_review_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.scheduling.upsert(sched(userId));

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/review'] });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/The team closed the/)).toBeTruthy();
    fireEvent.click(screen.getByText('解答を見る'));
    await screen.findByText('取引');
    expect(screen.getByText('close a deal')).toBeTruthy();
    await waitFor(async () => expect(await repos.wordCache.get(userId, 'deal')).toMatchObject(wordData));
  });

  it('surfaces an error from Setup when the generation API is unavailable (no silent fallback)', async () => {
    const userId = 'route_api_down_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    // Real HTTP gateway, but the generation proxy is unreachable (no backend running).
    const content = new HttpContentGateway({
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const container = await createContainer(userId, {
      db,
      content,
      now: () => 1_000_000,
      session: createSessionStore(),
      player: createPlayerStore(),
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

    fireEvent.click(await screen.findByTestId('exam-value-2')); // choose a level (英検2級)
    fireEvent.click(screen.getByText('文章を生成する'));

    // No mock passage: the connection error is shown and we stay on Setup.
    expect(await screen.findByText('生成サービスに接続できませんでした。時間をおいて再試行してください。')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(await createRepositories(db).passages.recent(userId, 5)).toHaveLength(0);
  });
});

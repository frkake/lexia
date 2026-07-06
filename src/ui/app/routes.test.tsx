// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { appRoutes } from '../router';
import { configWarningFor, generationErrorMessage } from './routes';
import { AppProvider } from './AppContext';
import { createContainer, degradingTts } from './container';
import { HttpContentGateway } from '../../infra/content/contentGatewayHttp';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { isImageRef } from '../../infra/persistence/imageStore';
import { createPlayerStore } from '../../state/stores/playerStore';
import { createSessionStore } from '../../state/stores/sessionStore';
import { createSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import { generationProgressStore } from '../../state/stores/generationProgressStore';
import { toastStore } from '../../state/stores/toastStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { ContentGateway } from '../../types/ports';
import type { PassageOutput, UserId, WordData, WordSchedulingState, WordSuggestionRequest } from '../../types/domain';

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
    collocations: [{ id: 'close-a-deal', pattern: 'close a deal', type: 'V+N', slotExamples: ['deal'], glossJa: '取引をまとめる', l1Contrast: false }],
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

function validNoticePassage(): PassageOutput {
  const passage = validPassage();
  return {
    ...passage,
    noticeCues: [
      {
        index: 1,
        span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 3 },
        category: 'sentence_structure',
        anchorText: 'They met again',
        explanationJa: '短い主語＋動詞＋副詞で場面を進める文。',
      },
    ],
  };
}

function sched(userId: UserId): WordSchedulingState {
  return {
    userId,
    wordId: 'deal',
    level: 'B1',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    // A-1-1: nothing is prefilled, so the seeded due word is NOT shown as a chip up front — it is
    // auto-selected at generation time instead.
    expect(screen.queryByTestId('target-deal')).toBeNull();

    fireEvent.click(screen.getByText('文章を生成する'));

    // Pipeline persisted the passage and the route navigated into Reading
    // (the title renders in both the mobile header and the main column).
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });
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

  it('keeps generating after the learner leaves Home and shows a completion toast instead of a forced jump (D-7)', async () => {
    generationProgressStore.getState().reset();
    toastStore.getState().clear();
    const userId = 'route_bg_gen_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    await createRepositories(db).scheduling.upsert(sched(userId));

    // A controllable server: generation stays in flight until we resolve it.
    const gen = deferred<{ passage: PassageOutput; stopReason: 'end_turn' }>();
    const gateway: ContentGateway = {
      generatePassage: () => gen.promise,
      async getWordData() {
        return wordData;
      },
    };
    const container = await createContainer(userId, {
      db,
      content: gateway,
      tts: degradingTts,
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

    fireEvent.click(await screen.findByText('文章を生成する'));
    // The in-place progress panel + the always-visible TopNav indicator appear.
    await screen.findByTestId('generation-progress');
    expect(screen.getByTestId('generation-indicator')).toBeTruthy();

    // Leave Home for the library while the generation is still running.
    fireEvent.click(screen.getByRole('link', { name: '文章' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));

    // The server finally replies — the pipeline (running in the route closure) finishes.
    await act(async () => {
      gen.resolve({ passage: validPassage(), stopReason: 'end_turn' });
      await Promise.resolve();
    });

    // No forced navigation off the library; a completion toast with an「開く」action appears instead.
    expect(await screen.findByText('文章ができました', undefined, { timeout: 3_000 })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/library');

    // Clicking「開く」opens the finished passage in the reader.
    fireEvent.click(screen.getByText('開く'));
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 3_000 });
  });

  it('excludes a looked-up study word from the read-through Good credit on completion (C-5d)', async () => {
    const userId = 'route_lookup_exclude_user' as UserId;
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
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });

    // Open the study word's detail: this fires a lookup (Again) and records the word for this session.
    fireEvent.click(within(screen.getByTestId('passage-prose')).getByText('deal'));
    await waitFor(async () => {
      const log = await repos.reviewLog.since(userId, 0);
      expect(log.some((e) => e.wordId === 'deal' && e.rating === 1 && e.source === 'passage')).toBe(true);
    });

    // Close the detail overlay, then complete reading.
    fireEvent.click(screen.getByRole('dialog', { name: '単語詳細' }));
    fireEvent.click(await screen.findByText('読了として記録'));
    await waitFor(async () => {
      const progress = await repos.progress.get(userId, container.session.getState().passage!.passageId);
      expect(progress?.status).toBe('completed');
    });

    // The looked-up word received NO read-through Good (rating 3) credit — only the lookup Again.
    const log = await repos.reviewLog.since(userId, 0);
    expect(log.some((e) => e.wordId === 'deal' && e.rating === 3)).toBe(false);
    // …and the completion feedback shows it needs review (1 word looked up).
    expect(screen.getByTestId('reading-completed-summary').textContent).toContain('1 語は要復習');
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
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });

    // The reading body is the sentence-unit grid (not flowing prose) …
    await waitFor(() => expect(screen.getByTestId('passage-prose').getAttribute('data-layout')).toBe('grid'));
    // … the first sentence's Japanese sits in its right cell …
    expect(screen.getByTestId('sentence-aside-0').textContent).toContain('今日、取引を成立させた。');
    // … and exactly one unified learning guide is rendered (not split into notice + study lists).
    expect(screen.getAllByText('学習ガイド')).toHaveLength(1);
    expect(screen.queryByText('この文章で気づきたいこと')).toBeNull();

    act(() => settingsStore.getState().setTranslationMode(prevMode)); // restore for sibling tests
  });

  it('marks a non-word notice expression as unknown from the reading right rail', async () => {
    const userId = 'route_unknown_notice_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.scheduling.upsert(sched(userId));

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validNoticePassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

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
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });

    // D-1 compact cards: the notice's 「知らなかった」action lives in the expand-on-click detail,
    // so open the card before recording the unknown.
    fireEvent.click(await screen.findByTestId('guide-item-notice:1'));
    fireEvent.click(await screen.findByLabelText('They met again を知らなかったとして記録'));

    await waitFor(async () => {
      const log = await repos.reviewLog.since(userId, 0);
      // F-3: reading-time「知らなかった」resets the interval (rating 1) but is recorded as a
      // reading-origin event (source='passage'), so it never inflates the weekly 復習 series.
      expect(
        log.some((entry) => entry.wordId === 'They met again' && entry.rating === 1 && entry.source === 'passage'),
      ).toBe(true);
    });
  });

  it('regenerates the current passage illustration and persists the replacement', async () => {
    const userId = 'route_illustration_regen_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    const passage = validPassage();
    passage.meta.sceneIllustrationUrl = 'data:image/png;base64,OLD';
    await repos.passages.put({ passageId: 'p1', userId, createdAt: 1_000, passage });

    let capturedTitle = '';
    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
      async illustratePassage(req) {
        capturedTitle = req.title;
        return 'data:image/png;base64,NEWSCENE';
      },
    };
    const session = createSessionStore();
    session.getState().startPassage(tokenizer.index('p1', passage), 1_000);
    const container = await createContainer(userId, {
      db,
      content: gateway,
      tts: degradingTts,
      now: () => 2_000,
      settings: createSettingsStore(),
      session,
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/p/p1'] });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('regenerate-passage-illustration'));

    await waitFor(async () => {
      expect((await repos.passages.get('p1'))?.passage.meta.sceneIllustrationUrl).toBe('data:image/png;base64,NEWSCENE');
      expect(container.session.getState().passage?.source.meta.sceneIllustrationUrl).toBe('data:image/png;base64,NEWSCENE');
    });
    expect(capturedTitle).toBe('取引の成立');
  });

  it('auto-backfills a scene illustration when revisiting a passage saved without one (E-3(e))', async () => {
    const userId = 'route_illustration_backfill_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    // A passage persisted WITHOUT a scene illustration (its image API failed at generation time).
    await repos.passages.put({ passageId: 'p1', userId, createdAt: 1_000, passage: validPassage() });

    let calls = 0;
    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
      async illustratePassage() {
        calls += 1;
        return `data:image/png;base64,${btoa('backfilled-scene')}`;
      },
    };
    // A FRESH (not pre-started) session so the reader opens the passage FROM STORAGE — the case the
    // backfill targets (a fresh in-session generation runs its own enrichment instead).
    const container = await createContainer(userId, {
      db,
      content: gateway,
      tts: degradingTts,
      now: () => 2_000,
      settings: createSettingsStore(),
      session: createSessionStore(),
    });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/p/p1'] });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    // While reading, the missing scene is backfilled into the images table and shown in place.
    await waitFor(async () => {
      const url = (await repos.passages.get('p1'))?.passage.meta.sceneIllustrationUrl;
      expect(isImageRef(url)).toBe(true);
      expect(container.session.getState().passage?.source.meta.sceneIllustrationUrl).toBe(url);
    }, { timeout: 5_000 });
    expect(await repos.images.all(userId)).toHaveLength(1);
    // Exactly one backfill call — the per-session guard prevents re-firing on re-render.
    expect(calls).toBe(1);
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
    // A-1-1 acceptance (1): opening Home does NOT call the suggestion API (no prefill).
    expect(suggestCalls).toBe(0);
    fireEvent.click(screen.getByText('文章を生成する'));

    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });
    // Suggestion is consulted only at generate time, to auto-select the woven-in words.
    expect(suggestCalls).toBeGreaterThanOrEqual(1);
    // The auto-proposed word is woven in AND tracked in the SRS so it can reappear later.
    await waitFor(async () => {
      const seeded = await createRepositories(db).scheduling.get(userId, 'deal');
      expect(seeded).toBeDefined();
    });
  });

  it('resolves target words at generation time using the current level (no mount-time suggest, no mismatch)', async () => {
    const userId = 'route_generate_keeps_candidates_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let suggestCalls = 0;
    const suggestRequests: WordSuggestionRequest[] = [];
    const gateway: ContentGateway = {
      async suggestWords(req) {
        suggestCalls += 1;
        suggestRequests.push(req);
        return ['deal'];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData(wordId) {
        return { ...wordData, wordId, headword: wordId };
      },
    };

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

    // A-1-1: no prefill, so no suggest at mount and no chip shown. Then the learner edits the level.
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    expect(suggestCalls).toBe(0);
    expect(screen.queryByTestId('target-deal')).toBeNull();
    fireEvent.change(screen.getByTestId('advanced-vocabulary-level'), { target: { value: 'C1' } });
    fireEvent.click(screen.getByText('文章を生成する'));

    // The single suggest call happens at generation time and uses the EDITED level (C1), so what is
    // woven in can never silently diverge from a stale prefilled selection.
    await waitFor(() => expect(suggestCalls).toBe(1));
    expect(suggestRequests[0]?.level).toBe('C1');

    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });
    await waitFor(async () => {
      const seeded = await createRepositories(db).scheduling.get(userId, 'deal');
      expect(seeded?.level).toBe('C1');
    });
    // The auto-selected word was NOT written back to the persisted setup (A-2-1 non-persistence).
    expect(container.settings.getState().lastSetup.targetWordIds).toEqual([]);
  });

  it('injects wordbook-carried words as manual chips and weaves them into the passage (A-3-2)', async () => {
    const userId = 'route_weave_inject_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let capturedTargetWords: string[] = [];
    const gateway: ContentGateway = {
      async suggestWords() {
        return [];
      },
      async generatePassage(req) {
        capturedTargetWords = req.targetWords.map((w) => w.wordId);
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData(wordId) {
        return { ...wordData, wordId, headword: wordId };
      },
    };
    const container = await createContainer(userId, {
      db,
      content: gateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings: createSettingsStore(),
    });
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/', state: { addWordIds: ['ledger', 'audit'] } }],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    // The words carried from the wordbook are seeded as manual chips on the Setup form.
    expect(await screen.findByTestId('target-added-ledger')).toBeTruthy();
    expect(screen.getByTestId('target-added-audit')).toBeTruthy();

    // Generating weaves every carried word into the passage request (criterion 2).
    fireEvent.click(screen.getByText('文章を生成する'));
    await waitFor(() => expect(screen.getAllByText('取引の成立').length).toBeGreaterThan(0), { timeout: 5_000 });
    expect(capturedTargetWords).toContain('ledger');
    expect(capturedTargetWords).toContain('audit');
  });

  it('does not re-inject carried words on a later Home revisit without state (A-3-2 criterion 3)', async () => {
    const userId = 'route_weave_reinject_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const gateway: ContentGateway = {
      async suggestWords() {
        return [];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };
    const container = await createContainer(userId, {
      db,
      content: gateway,
      tts: degradingTts,
      now: () => 1_000_000,
      settings: createSettingsStore(),
    });
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [{ pathname: '/', state: { addWordIds: ['ledger'] } }],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('target-added-ledger')).toBeTruthy();
    // Leave Home (no generation → the words were never persisted as manual) and come back with no
    // state: the carried word must NOT be re-injected.
    await act(async () => {
      await router.navigate('/wordbook');
    });
    await act(async () => {
      await router.navigate('/');
    });
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    expect(screen.queryByTestId('target-added-ledger')).toBeNull();
  });

  it('weaves a word from the Home due-word overlay via a same-route /→/ navigation (A-3-2)', async () => {
    // Regression: onWeave from the Home overlay does navigate('/', { addWordIds }) while already at '/',
    // so React Router does NOT remount HomeRoute. The old one-shot capture skipped the re-read, so the
    // word was silently dropped (no target-added chip) AND the overlay stayed open. Only the cross-route
    // weave (from /wordbook or /review) worked. This exercises the broken same-route path end to end.
    const userId = 'route_home_overlay_weave_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    await createRepositories(db).scheduling.upsert(sched(userId)); // 'deal' due now → shows in the ledger

    const gateway: ContentGateway = {
      async suggestWords() {
        return [];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData; // wordId 'deal'
      },
    };
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

    // Home is up and the word has NOT yet been carried into the Setup form.
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    expect(screen.queryByTestId('target-added-deal')).toBeNull();

    // Open the due-word detail overlay from the ledger, then weave (same-route '/'→'/').
    fireEvent.click(await screen.findByTestId('due-word-deal'));
    expect(await screen.findByRole('dialog', { name: '単語詳細' })).toBeTruthy();
    fireEvent.click(await screen.findByTestId('weave-word'));

    // The word is now a manual chip on the Setup form AND the overlay has dismissed itself.
    expect(await screen.findByTestId('target-added-deal')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '単語詳細' })).toBeNull());
  });

  it('refreshes setup candidate words from the route wiring', async () => {
    const userId = 'route_refresh_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let suggestCalls = 0;
    const suggestRequests: WordSuggestionRequest[] = [];
    const gateway: ContentGateway = {
      async suggestWords(req) {
        suggestCalls += 1;
        suggestRequests.push(req);
        return suggestCalls === 1 ? ['alpha'] : ['beta'];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

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

    // A-1-1: no candidates until the learner explicitly previews (「自動選択をプレビュー」).
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    expect(screen.queryByTestId('target-alpha')).toBeNull();
    fireEvent.click(screen.getByTestId('refresh-candidates')); // first preview → alpha
    expect(await screen.findByTestId('target-alpha')).toBeTruthy();
    fireEvent.click(screen.getByTestId('refresh-candidates')); // re-roll → beta, avoiding alpha
    expect(await screen.findByTestId('target-beta')).toBeTruthy();
    expect(screen.queryByTestId('target-alpha')).toBeNull();
    expect(suggestCalls).toBeGreaterThanOrEqual(2);
    expect(suggestRequests[suggestRequests.length - 1]?.exclude).toContain('alpha');
  });

  it('resets setup target words from the route wiring, clearing exclusions and reloading candidates', async () => {
    const userId = 'route_reset_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    let suggestCalls = 0;
    const suggestRequests: WordSuggestionRequest[] = [];
    const gateway: ContentGateway = {
      async suggestWords(req) {
        suggestCalls += 1;
        suggestRequests.push(req);
        return ['alpha', 'gamma'];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

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

    // Preview to load candidates, exclude one, then reset.
    expect(await screen.findByRole('heading', { name: '学習をはじめる' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('refresh-candidates'));
    expect(await screen.findByTestId('target-alpha')).toBeTruthy();
    fireEvent.click(screen.getByTestId('target-alpha')); // exclude alpha
    fireEvent.click(screen.getByTestId('reset-candidates'));

    // lastSetup is patched with cleared target/excluded words (A-2-1).
    await waitFor(() => {
      const setup = container.settings.getState().lastSetup;
      expect(setup.excludedWordIds).toEqual([]);
      expect(setup.targetWordIds).toEqual([]);
    });
    // The on-screen preview is cleared too — reset returns the section to its empty default.
    expect(screen.queryByTestId('target-alpha')).toBeNull();

    // Previewing again offers the previously-excluded word (the exclusion is no longer carried).
    fireEvent.click(screen.getByTestId('refresh-candidates'));
    expect(await screen.findByTestId('target-alpha')).toBeTruthy();
    expect(suggestCalls).toBeGreaterThanOrEqual(2);
    expect(suggestRequests[suggestRequests.length - 1]?.exclude ?? []).not.toContain('alpha');
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

    // Confirm gate first, then open the session (C-5c: nothing is graded until 開始).
    fireEvent.click(await screen.findByTestId('review-start-button'));
    expect(await screen.findByText(/The team closed the/)).toBeTruthy();
    fireEvent.click(screen.getByText('解答を見る'));
    await screen.findByText('取引');
    expect(screen.getByText('close a deal')).toBeTruthy();
    await waitFor(async () => expect(await repos.wordCache.get(userId, 'deal')).toMatchObject(wordData));
  });

  it('marks a word as unknown from the word detail card and records a passage-origin Again (F-3)', async () => {
    const userId = 'route_unknown_user' as UserId;
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
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/wordbook'] });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('word-row-deal'));
    fireEvent.click(await screen.findByTestId('mark-unknown'));

    await waitFor(async () => {
      const log = await repos.reviewLog.since(userId, 0);
      // F-3: an Again reschedule, but logged as source='passage' (reading-time miss, not a review).
      expect(log.some((entry) => entry.wordId === 'deal' && entry.rating === 1 && entry.source === 'passage')).toBe(true);
    });
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

  it('renders the word card as a standalone page at /w/:wordId and closes to the wordbook (no history)', async () => {
    const userId = 'route_word_page_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/w/deal'] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    // The shared WordDetailCard body renders as a full page (unique collocation chip).
    expect(await screen.findByText('close a deal')).toBeTruthy();
    expect(screen.getByText('意味')).toBeTruthy();

    // Direct load (location.key === 'default') → close returns to the wordbook, not out of the app.
    fireEvent.click(screen.getByLabelText('閉じる'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/wordbook'));
  });

  it('shows a not-found empty state at /w/:wordId when the word data cannot be loaded', async () => {
    const userId = 'route_word_page_missing_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        throw new Error('not found');
      },
    };

    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/w/no-such-word'] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('この単語は見つかりませんでした')).toBeTruthy();
    fireEvent.click(screen.getByText('単語帳へ戻る'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/wordbook'));
  });

  it('renders a Japanese 404 for an unknown URL with a link home', async () => {
    const userId = 'route_404_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/totally-unknown-page'] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('ページが見つかりません')).toBeTruthy();
    fireEvent.click(screen.getByText('ホームへ戻る'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('shows a retryable error in the word detail overlay when word data cannot be loaded, then recovers (E-3 a\')', async () => {
    const userId = 'route_word_detail_error_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.scheduling.upsert(sched(userId)); // seeds a wordbook row for 'deal' (no cache yet)

    let failWord = true;
    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        if (failWord) throw new Error('offline');
        return wordData;
      },
    };

    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/wordbook'] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('word-row-deal'));
    // Cache miss + gateway down → explicit error UI with a retry action (never an infinite「読み込み中…」).
    expect(await screen.findByText('単語情報の取得に失敗しました')).toBeTruthy();

    // The gateway recovers and 再試行 loads + renders the card (and caches it).
    failWord = false;
    fireEvent.click(screen.getByText('再試行'));
    expect(await screen.findByText('close a deal')).toBeTruthy();
    await waitFor(async () => expect(await repos.wordCache.get(userId, 'deal')).toBeTruthy());
  });

  it('paints the first review card frame before its word data resolves (E-3 f), then rates after reveal', async () => {
    const userId = 'route_review_lazy_user' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await repos.scheduling.upsert(sched(userId));

    const wordGate = deferred<WordData>();
    const gateway: ContentGateway = {
      async suggestWords() {
        return [];
      },
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordGate.promise; // held open → the card stays in its skeleton until we resolve it
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

    // Confirm gate → open the session; its first frame paints from the frozen snapshot alone while
    // WordData is still in flight (E-3(f): no blocking wait over the whole queue).
    fireEvent.click(await screen.findByTestId('review-start-button'));
    expect(await screen.findByText('復習セッション')).toBeTruthy();
    expect(screen.getByTestId('review-loading')).toBeTruthy();

    // Once WordData resolves the card becomes answerable; reveal then rate is logged.
    wordGate.resolve(wordData);
    fireEvent.click(await screen.findByText('解答を見る'));
    fireEvent.click(screen.getByTestId('rate-3'));
    await waitFor(async () => {
      const log = await repos.reviewLog.since(userId, 0);
      expect(log.some((e) => e.wordId === 'deal' && e.source === 'review')).toBe(true);
    });
  });
});

describe('generationErrorMessage branches (F-1)', () => {
  it('gives a not_configured error its own setup-steps message and never the "try again later" wording', () => {
    const msg = generationErrorMessage({ kind: 'not_configured', status: 503, message: 'OPENAI_API_KEY missing' });
    expect(msg).toContain('API キーが未設定');
    expect(msg).toContain('server/.env');
    // The core acceptance criterion: a config problem must not be rounded down to "wait and retry".
    expect(msg).not.toContain('時間をおいて再試行');
  });

  it('keeps distinct wording for rate_limited vs. unavailable/network (regression guard)', () => {
    expect(generationErrorMessage({ kind: 'rate_limited' })).toContain('混み合っています');
    expect(generationErrorMessage({ kind: 'unavailable' })).toContain('時間をおいて再試行');
    expect(generationErrorMessage({ kind: 'network' })).toContain('時間をおいて再試行');
  });

  it('falls back to a generic message for a shapeless error', () => {
    expect(generationErrorMessage(new Error('boom'))).toBe('文章生成に失敗しました。条件を確認してもう一度試してください。');
  });
});

describe('configWarningFor (F-1)', () => {
  it('returns null when the key is configured', () => {
    expect(configWarningFor({ configured: true, provider: 'openai' })).toBeNull();
  });

  it('names the active provider key when unconfigured', () => {
    expect(configWarningFor({ configured: false, provider: 'openai' })).toContain('OPENAI_API_KEY');
    expect(configWarningFor({ configured: false, provider: 'anthropic' })).toContain('ANTHROPIC_API_KEY');
  });
});

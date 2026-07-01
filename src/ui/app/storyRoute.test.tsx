// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
import { createSettingsStore } from '../../state/stores/settingsStore';
import type { ContentGateway, StoryGateway } from '../../types/ports';
import type { PassageOutput, StoryPlan, UserId } from '../../types/domain';

const PLAN: StoryPlan = {
  storyId: 'story_1',
  contentType: 'short_story',
  genre: 'fantasy',
  titleJa: '星の少女',
  synopsisJa: '少女が星を探す短い物語。',
  characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
  chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
};

const FILLER = ['She', 'walked', 'under', 'the', 'bright', 'night', 'sky', 'alone', '.'];
function chapterPassage(): PassageOutput {
  return {
    meta: {
      title: '星の少女 第一章',
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
      storyRef: { storyId: 'story_1', chapterIndex: 0 },
    },
    // ~40 sentences × 8 words ≈ 320 words, comfortably inside the default 400-word target's band.
    sentences: Array.from({ length: 40 }, () => ({ tokens: [...FILLER], translationJa: '彼女は夜空の下を歩いた。' })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

const storyGateway: StoryGateway = { planStory: async () => PLAN };
const contentGateway: ContentGateway = {
  generatePassage: async () => ({ passage: chapterPassage(), stopReason: 'end_turn' }),
  getWordData: async () => {
    throw new Error('unused');
  },
  suggestWords: async () => [],
};

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
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/setup'] });
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

    // Confirm → chapter is generated, persisted with the story link, and we land on Reading.
    fireEvent.click(screen.getByText('この設定で執筆する'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/read'));
    await waitFor(async () => {
      expect(await createRepositories(db).stories.recent(userId, 5)).toHaveLength(1);
      const passages = await createRepositories(db).passages.recent(userId, 5);
      expect(passages).toHaveLength(1);
      expect(passages[0]!.passage.meta.storyRef?.storyId).toBe('story_1');
    });
    db.close();
  });
});

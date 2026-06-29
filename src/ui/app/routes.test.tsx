// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { appRoutes } from '../router';
import { AppProvider } from './AppContext';
import { createContainer, degradingTts } from './container';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
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
  core: { meaningsJa: ['取引'], examples: [], collocations: ['close a deal'], synonymNuances: [] },
};

function validPassage(): PassageOutput {
  return {
    meta: { title: '取引の成立', theme: '交渉', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 5 },
    sentences: [{ tokens: ['We', 'closed', 'the', 'deal', 'today', '.'], translationJa: '今日、取引を成立させた。' }],
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
    const container = await createContainer(userId, { db, content: gateway, tts: degradingTts, now: () => 1_000_000 });
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/setup'] });

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
  });
});

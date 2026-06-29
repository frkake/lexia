// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useScheduling } from './useScheduling';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import type { UserId, WordSchedulingState } from '../../types/domain';

function sched(userId: UserId, wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

describe('useScheduling (live query)', () => {
  it('re-renders immediately when scheduling state changes', async () => {
    const userId = 'sched_live' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repo = createRepositories(db).scheduling;

    const { result } = renderHook(() => useScheduling(db, userId));

    await waitFor(() => expect(result.current?.mastery.total).toBe(0));

    await repo.upsert(sched(userId, 'w1', { stability: 4, dueAt: 1, mastery: 'Learning' }));

    await waitFor(() => {
      expect(result.current?.mastery.total).toBe(1);
      expect(result.current?.due.map((s) => s.wordId)).toEqual(['w1']);
    });

    db.close();
  });
});

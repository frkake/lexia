import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { readSchedulingView } from './useScheduling';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import type { UserId, WordSchedulingState } from '../../types/domain';

let seq = 0;
async function freshDb(): Promise<{ db: LexiaDb; userId: UserId }> {
  const userId = `sched_view_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { db, userId };
}

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

describe('readSchedulingView', () => {
  it('derives all/due/mastery from stored scheduling state', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).scheduling;
    await repo.upsert(sched(userId, 'dueA', { stability: 4, dueAt: 100, mastery: 'Learning' }));
    await repo.upsert(sched(userId, 'dueB', { stability: 10, dueAt: 50, mastery: 'Consolidating' }));
    await repo.upsert(sched(userId, 'later', { stability: 40, dueAt: 9_999, mastery: 'Mastered' }));
    const isNew = sched(userId, 'fresh', { mastery: 'New' });
    delete isNew.stability;
    await repo.upsert(isNew);

    const view = await readSchedulingView(db, userId, 1_000);
    expect(view.all).toHaveLength(4);
    expect(view.due.map((s) => s.wordId)).toEqual(['dueB', 'dueA']); // due-soonest first, New excluded
    expect(view.mastery).toEqual({ New: 1, Learning: 1, Consolidating: 1, Mastered: 1, total: 4 });
    db.close();
  });
});

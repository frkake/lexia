import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { JsonSyncAdapter, SYNC_FORMAT_VERSION } from './exportImport';
import { LexiaDb } from '../persistence/lexiaDb';
import { createRepositories } from '../persistence/repositories';
import type { UserId, WordSchedulingState, ReviewLogEntry, ReadingProgress } from '../../types/domain';

const U = 'userA' as UserId;

async function openDb(userId: string): Promise<LexiaDb> {
  const db = new LexiaDb(userId);
  await db.open();
  return db;
}

function sched(wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: U,
    wordId,
    stability: 12,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 100,
    dueAt: 5_000,
    lastSource: 'review',
    mastery: 'Consolidating',
    reappearCount: 1,
    ...over,
  };
}

const stripId = (e: ReviewLogEntry): Omit<ReviewLogEntry, 'id'> => {
  const copy = { ...e };
  delete copy.id;
  return copy;
};

describe('JsonSyncAdapter', () => {
  it('round-trips scheduling, review log, progress and settings exactly', async () => {
    const dbA = await openDb('export_src');
    const reposA = createRepositories(dbA);
    await reposA.scheduling.upsert(sched('w1'));
    await reposA.scheduling.upsert(sched('w2', { stability: 3, mastery: 'Learning' }));
    await reposA.reviewLog.append({ userId: U, wordId: 'w1', rating: 3, source: 'review', at: 100 });
    await reposA.reviewLog.append({ userId: U, wordId: 'w1', rating: 1, source: 'passage', at: 200, stabilityAfter: 8 });
    const progress: ReadingProgress = {
      userId: U,
      passageId: 'p1',
      sentenceIndex: 1,
      percent: 30,
      status: 'in_progress',
      startedAt: 50,
    };
    await reposA.progress.upsert(progress);
    await reposA.settings.put({
      userId: U,
      translationMode: 'per_sentence',
      fontScale: 1.1,
      voiceId: 'joanna',
      rate: 1,
      theme: 'light',
      locale: 'ja',
      lastSetup: { level: 'B1', themes: ['travel'], newWordRatio: 0.3, length: 'short', targetWordIds: ['w1'], excludedWordIds: [] },
    });

    const blob = await new JsonSyncAdapter(dbA).export(U);
    expect(blob.type).toBe('application/json');
    const parsed = JSON.parse(await blob.text());
    expect(parsed.formatVersion).toBe(SYNC_FORMAT_VERSION);

    // Import into a fresh database under the same namespace.
    const dbB = await openDb('export_dst');
    await new JsonSyncAdapter(dbB).import(U, blob);
    const reposB = createRepositories(dbB);

    const schedA = (await dbA.scheduling.where('userId').equals(U).toArray()).sort((a, b) => a.wordId.localeCompare(b.wordId));
    const schedB = (await dbB.scheduling.where('userId').equals(U).toArray()).sort((a, b) => a.wordId.localeCompare(b.wordId));
    expect(schedB).toEqual(schedA);

    const logA = (await reposA.reviewLog.since(U, 0)).map(stripId);
    const logB = (await reposB.reviewLog.since(U, 0)).map(stripId);
    expect(logB).toEqual(logA);

    expect(await reposB.progress.get(U, 'p1')).toEqual(progress);
    expect((await reposB.settings.get(U))?.voiceId).toBe('joanna');

    dbA.close();
    dbB.close();
  });
});

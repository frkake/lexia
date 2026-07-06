// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { setWordSuspended } from './suspensionController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories, type Repositories } from '../../infra/persistence/repositories';
import { DAY_MS } from '../../domain/srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

let seq = 0;
async function freshRepos(): Promise<{ repos: Repositories; userId: UserId }> {
  const userId = `suspend_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { repos: createRepositories(db), userId };
}

function sched(userId: UserId, wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 5 * DAY_MS,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

describe('setWordSuspended', () => {
  it('suspends an existing word (persisted suspended=true)', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1'));

    const next = await setWordSuspended({ scheduling: repos.scheduling }, userId, 'w1', true, DAY_MS);

    expect(next?.suspended).toBe(true);
    expect((await repos.scheduling.get(userId, 'w1'))?.suspended).toBe(true);
  });

  it('restores a suspended word (suspended cleared to false)', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1', { suspended: true }));

    const next = await setWordSuspended({ scheduling: repos.scheduling }, userId, 'w1', false, DAY_MS);

    expect(next?.suspended).toBe(false);
    expect((await repos.scheduling.get(userId, 'w1'))?.suspended).toBe(false);
  });

  it('seeds a suspended New state when suspending a word with no scheduling row yet', async () => {
    const { repos, userId } = await freshRepos();

    const next = await setWordSuspended({ scheduling: repos.scheduling }, userId, 'fresh', true, DAY_MS);

    expect(next?.suspended).toBe(true);
    expect(next?.stability).toBeUndefined(); // New: never entered the review loop
    expect((await repos.scheduling.get(userId, 'fresh'))?.suspended).toBe(true);
  });

  it('is a no-op restoring a word that has no scheduling row', async () => {
    const { repos, userId } = await freshRepos();

    const next = await setWordSuspended({ scheduling: repos.scheduling }, userId, 'ghost', false, DAY_MS);

    expect(next).toBeUndefined();
    expect(await repos.scheduling.get(userId, 'ghost')).toBeUndefined();
  });

  it('leaves the row untouched when already in the desired state', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1', { suspended: true }));
    const before = await repos.scheduling.get(userId, 'w1');

    const next = await setWordSuspended({ scheduling: repos.scheduling }, userId, 'w1', true, DAY_MS);

    expect(next).toEqual(before);
  });
});

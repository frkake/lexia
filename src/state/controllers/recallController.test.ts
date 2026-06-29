// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { applyRecallSignal } from './recallController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories, type Repositories } from '../../infra/persistence/repositories';
import { DAY_MS } from '../../domain/srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

let seq = 0;
async function freshRepos(): Promise<{ repos: Repositories; userId: UserId }> {
  const userId = `recall_${seq++}` as UserId;
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

describe('applyRecallSignal (Flow 3 wiring)', () => {
  it('a tap-free read-through updates stability and appends a passage log', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 5 }));

    const out = await applyRecallSignal(repos, userId, { kind: 'read_through', wordId: 'w1', at: 10 * DAY_MS });

    expect(out.applied).toBe(true);
    const stored = await repos.scheduling.get(userId, 'w1');
    expect(stored?.lastSource).toBe('passage');
    expect(stored?.reappearCount).toBe(1);
    const log = await repos.reviewLog.since(userId, 0);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ wordId: 'w1', source: 'passage', rating: 3 });
  });

  it('a lookup tap grades Again (a lapse)', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 8, lapses: 0 }));

    const out = await applyRecallSignal(repos, userId, { kind: 'lookup', wordId: 'w1', at: 10 * DAY_MS });

    expect(out.applied).toBe(true);
    expect(out.state.lapses).toBe(1);
    const log = await repos.reviewLog.since(userId, 0);
    expect(log[0]).toMatchObject({ rating: 1, source: 'passage' });
  });

  it('suppresses a second same-day passage update (no double counting)', async () => {
    const { repos, userId } = await freshRepos();
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 5 }));

    await applyRecallSignal(repos, userId, { kind: 'read_through', wordId: 'w1', at: 10 * DAY_MS });
    const afterFirst = await repos.scheduling.get(userId, 'w1');

    const second = await applyRecallSignal(repos, userId, { kind: 'read_through', wordId: 'w1', at: 10 * DAY_MS + DAY_MS / 2 });

    expect(second.applied).toBe(false);
    const afterSecond = await repos.scheduling.get(userId, 'w1');
    expect(afterSecond).toEqual(afterFirst); // unchanged
    const log = await repos.reviewLog.since(userId, 0);
    expect(log).toHaveLength(1); // only the first update logged
  });

  it('seeds a New state when the word has no scheduling row yet', async () => {
    const { repos, userId } = await freshRepos();

    const out = await applyRecallSignal(repos, userId, { kind: 'read_through', wordId: 'fresh', at: DAY_MS });

    expect(out.applied).toBe(true);
    const stored = await repos.scheduling.get(userId, 'fresh');
    expect(stored).toBeDefined();
    expect(stored?.stability).toBeGreaterThan(0); // bootstrapped from New
  });

  it('never promotes the mastery stage from a passage event', async () => {
    const { repos, userId } = await freshRepos();
    // A Learning word whose stability already exceeds the consolidate threshold:
    // an explicit review could promote it, but a passage read-through must not.
    await repos.scheduling.upsert(sched(userId, 'w1', { stability: 9, mastery: 'Learning' }));

    const out = await applyRecallSignal(repos, userId, { kind: 'read_through', wordId: 'w1', at: 20 * DAY_MS });

    expect(out.state.mastery).toBe('Learning');
  });
});

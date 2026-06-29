import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { AuthAdapter, ANONYMOUS_USER_ID, migrateAnonymousNamespace } from './authAdapter';
import type { AdjacentAuth } from './authAdapter';
import { LexiaDb } from '../persistence/lexiaDb';
import { createRepositories } from '../persistence/repositories';
import type { UserId } from '../../types/domain';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function openDb(userId: string): Promise<LexiaDb> {
  const db = new LexiaDb(userId);
  await db.open();
  return db;
}

function fakeAdjacent(initial: string | null) {
  let current = initial;
  let listener: ((u: string | null) => void) | null = null;
  const auth: AdjacentAuth = {
    currentUserId: () => current,
    subscribe: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  };
  return {
    auth,
    emit: (u: string | null) => {
      current = u;
      listener?.(u);
    },
  };
}

describe('AuthAdapter', () => {
  it('reports the anonymous id and isAnonymous before sign-in', async () => {
    const f = fakeAdjacent(null);
    const adapter = new AuthAdapter(f.auth, { migrate: async () => {} });
    expect(await adapter.getUserId()).toBe(ANONYMOUS_USER_ID);
    expect(adapter.isAnonymous()).toBe(true);
  });

  it('reports the signed-in id once available', async () => {
    const f = fakeAdjacent('user123');
    const adapter = new AuthAdapter(f.auth, { migrate: async () => {} });
    expect(await adapter.getUserId()).toBe('user123');
    expect(adapter.isAnonymous()).toBe(false);
  });

  it('migrates exactly once on the first anonymous → signed-in transition', async () => {
    const f = fakeAdjacent(null);
    let migrations = 0;
    const adapter = new AuthAdapter(f.auth, {
      migrate: async () => {
        migrations += 1;
      },
    });
    const seen: UserId[] = [];
    adapter.onUserChange((u) => seen.push(u));

    f.emit('user123');
    await flush();
    expect(migrations).toBe(1);
    expect(seen).toContain('user123' as UserId);

    f.emit('user123'); // subsequent change: no second migration
    await flush();
    expect(migrations).toBe(1);
  });
});

describe('migrateAnonymousNamespace', () => {
  it('restores anonymous scheduling and review log under the signed-in namespace', async () => {
    // Seed the anonymous namespace with learning data.
    const anon = await openDb(ANONYMOUS_USER_ID);
    const repos = createRepositories(anon);
    await repos.scheduling.upsert({
      userId: ANONYMOUS_USER_ID,
      wordId: 'w1',
      stability: 12,
      difficulty: 5,
      reps: 2,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: 100,
      dueAt: 5000,
      lastSource: 'review',
      mastery: 'Consolidating',
      reappearCount: 1,
    });
    await repos.reviewLog.append({ userId: ANONYMOUS_USER_ID, wordId: 'w1', rating: 3, source: 'review', at: 100 });
    anon.close();

    await migrateAnonymousNamespace('user123' as UserId, openDb);

    const target = await openDb('user123');
    const targetRepos = createRepositories(target);
    const migrated = await targetRepos.scheduling.get('user123' as UserId, 'w1');
    expect(migrated).toBeDefined();
    expect(migrated!.userId).toBe('user123');
    expect(migrated!.stability).toBe(12);
    const log = await targetRepos.reviewLog.since('user123' as UserId, 0);
    expect(log).toHaveLength(1);
    expect(log[0]!.userId).toBe('user123');
    expect(log[0]!.rating).toBe(3);
    target.close();
  });
});

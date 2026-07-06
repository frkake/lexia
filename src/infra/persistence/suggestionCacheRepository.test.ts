import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LexiaDb } from './lexiaDb';
import { DexieSuggestionCacheRepository } from './suggestionCacheRepository';
import type { UserId } from '../../types/domain';

async function freshDb(userId: string): Promise<LexiaDb> {
  const db = new LexiaDb(userId);
  await db.open();
  return db;
}

describe('DexieSuggestionCacheRepository', () => {
  it('round-trips a proposal pool by [userId, suggestionKey]', async () => {
    const U = 'u_suggest_rt' as UserId;
    const db = await freshDb(String(U));
    const repo = new DexieSuggestionCacheRepository(db);

    expect(await repo.get(U, 'B1|daily')).toBeUndefined();

    await repo.put(U, 'B1|daily', { proposals: ['alpha', 'beta'], updatedAt: '2026-07-06T00:00:00.000Z' });
    const got = await repo.get(U, 'B1|daily');
    expect(got).toEqual({ proposals: ['alpha', 'beta'], updatedAt: '2026-07-06T00:00:00.000Z' });
    db.close();
  });

  it('overwrites the row on a re-put for the same key (latest proposals + updatedAt win)', async () => {
    const U = 'u_suggest_overwrite' as UserId;
    const db = await freshDb(String(U));
    const repo = new DexieSuggestionCacheRepository(db);

    await repo.put(U, 'B2|business', { proposals: ['old'], updatedAt: '2026-07-01T00:00:00.000Z' });
    await repo.put(U, 'B2|business', { proposals: ['new1', 'new2'], updatedAt: '2026-07-06T00:00:00.000Z' });

    expect(await repo.get(U, 'B2|business')).toEqual({
      proposals: ['new1', 'new2'],
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
    db.close();
  });

  it('keys are isolated per (level, intent) key', async () => {
    const U = 'u_suggest_keys' as UserId;
    const db = await freshDb(String(U));
    const repo = new DexieSuggestionCacheRepository(db);

    await repo.put(U, 'B1|daily', { proposals: ['d1'], updatedAt: '2026-07-06T00:00:00.000Z' });
    await repo.put(U, 'B1|business', { proposals: ['b1'], updatedAt: '2026-07-06T00:00:00.000Z' });

    expect((await repo.get(U, 'B1|daily'))?.proposals).toEqual(['d1']);
    expect((await repo.get(U, 'B1|business'))?.proposals).toEqual(['b1']);
    db.close();
  });
});

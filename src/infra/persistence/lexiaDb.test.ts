import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  LexiaDb,
  APP_SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  dbName,
  requestPersistentStorage,
  type SchemaVersion,
  type StoredSettings,
} from './lexiaDb';
import type { UserId, WordSchedulingState } from '../../types/domain';

function schedRow(userId: UserId, wordId: string): WordSchedulingState {
  return {
    userId,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 1000,
    dueAt: 2000,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
  };
}

describe('LexiaDb schema + migrations', () => {
  it('namespaces the database per user', () => {
    expect(dbName('abc')).toBe('lexia_abc');
    expect(dbName('anonymous')).toBe('lexia_anonymous');
  });

  it('opens at the latest schema version and round-trips a scheduling row', async () => {
    const U = 'u_roundtrip' as UserId;
    const db = new LexiaDb(U);
    await db.open();
    expect(db.verno).toBe(APP_SCHEMA_VERSION);

    const row = schedRow(U, 'w1');
    await db.scheduling.put(row);
    expect(await db.scheduling.get([U, 'w1'])).toEqual(row);
    db.close();
  });

  it('persists APP_SCHEMA_VERSION alongside settings', async () => {
    const U = 'u_settings' as UserId;
    const db = new LexiaDb(U);
    await db.open();
    const stored: StoredSettings = {
      userId: U,
      translationMode: 'off',
      fontScale: 1,
      voiceId: 'v',
      rate: 1,
      theme: 'system',
      locale: 'ja',
      lastSetup: {
        level: 'B1',
        themes: [],
        newWordRatio: 0.3,
        length: 'short',
        targetWordIds: [],
        excludedWordIds: [],
      },
      appSchemaVersion: APP_SCHEMA_VERSION,
    };
    await db.settings.put(stored);
    expect((await db.settings.get(U))?.appSchemaVersion).toBe(APP_SCHEMA_VERSION);
    db.close();
  });

  it('appends review-log entries with auto-incremented keys', async () => {
    const U = 'u_log' as UserId;
    const db = new LexiaDb(U);
    await db.open();
    const k1 = await db.reviewLog.add({ userId: U, wordId: 'w1', rating: 3, source: 'review', at: 1 });
    const k2 = await db.reviewLog.add({ userId: U, wordId: 'w1', rating: 2, source: 'passage', at: 2 });
    expect(k2).toBeGreaterThan(k1);
    expect(await db.reviewLog.count()).toBe(2);
    db.close();
  });

  it('runs numbered migrations, preserving invariants while back-filling new data', async () => {
    const U = 'u_mig' as UserId;

    // Seed at v1 only — an "old" scheduling row that predates reappearCount.
    const v1Only = new LexiaDb(U, [SCHEMA_VERSIONS[0]!]);
    await v1Only.open();
    expect(v1Only.verno).toBe(1);
    await v1Only.table('scheduling').put({
      userId: U,
      wordId: 'w1',
      stability: 9,
      difficulty: 6,
      reps: 3,
      lapses: 1,
      learningStep: 0,
      lastReviewAt: 10,
      dueAt: 20,
      lastSource: 'review',
      mastery: 'Consolidating',
      // reappearCount intentionally absent (legacy row)
    });
    v1Only.close();

    // A follow-on migration that back-fills reappearCount.
    const v2: SchemaVersion = {
      version: 2,
      stores: {
        scheduling: '[userId+wordId], userId, dueAt, stability, mastery, reappearCount',
      },
      upgrade: async (tx) => {
        await tx
          .table('scheduling')
          .toCollection()
          .modify((r: Record<string, unknown>) => {
            if (r.reappearCount === undefined) r.reappearCount = 0;
          });
      },
    };

    const migrated = new LexiaDb(U, [SCHEMA_VERSIONS[0]!, v2]);
    await migrated.open();
    expect(migrated.verno).toBe(2);

    const got = await migrated.scheduling.get([U, 'w1']);
    expect(got?.reappearCount).toBe(0); // back-filled
    expect(got?.difficulty).toBe(6); // invariant preserved
    expect(got?.stability).toBe(9);
    expect(got?.mastery).toBe('Consolidating');
    migrated.close();
  });

  it('requestPersistentStorage resolves false when the Storage API is unavailable', async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });
});

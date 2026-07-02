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
        examTarget: { kind: 'eiken', value: '2' },
        intent: 'daily',
        newWordRatio: 0.3,
        wordTarget: 200,
        contentType: 'article',
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

  // ── Requirement 6.6 / 7.5 / 8.5 / 9.5: additive v2 migration ────────────────
  describe('v2 migration (settings convert / stories store / appSchemaVersion stamp)', () => {
    it('converts a legacy settings row (level→examTarget, length→wordTarget, themes→intent) and stamps v2', async () => {
      const U = 'u_v2_settings' as UserId;

      // Seed at v1 with the OLD SetupConfig shape (level / themes / length).
      const v1 = new LexiaDb(U, [SCHEMA_VERSIONS[0]!]);
      await v1.open();
      await v1.table('settings').put({
        userId: U,
        translationMode: 'off',
        fontScale: 1,
        voiceId: 'v',
        rate: 1,
        theme: 'system',
        locale: 'ja',
        lastSetup: { level: 'B2', themes: ['business'], newWordRatio: 0.3, length: 'long', targetWordIds: [], excludedWordIds: [] },
        appSchemaVersion: 1,
      } as never);
      v1.close();

      // Open at the real latest schema (which includes v2).
      const db = new LexiaDb(U);
      await db.open();
      expect(db.verno).toBe(APP_SCHEMA_VERSION);
      expect(APP_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);

      const stored = (await db.settings.get(U)) as StoredSettings & {
        lastSetup: { level?: unknown; themes?: unknown; length?: unknown };
      };
      // Difficulty: CEFR B2 → an exam criterion (default 英検 準1).
      expect(stored.lastSetup.examTarget).toEqual({ kind: 'eiken', value: '準1' });
      // Length: legacy 'long' → 800-word target.
      expect(stored.lastSetup.wordTarget).toBe(800);
      // Themes: 'business' theme → business intent.
      expect(stored.lastSetup.intent).toBe('business');
      // Content type defaults to article.
      expect(stored.lastSetup.contentType).toBe('article');
      // Legacy fields removed.
      expect(stored.lastSetup.level).toBeUndefined();
      expect(stored.lastSetup.themes).toBeUndefined();
      expect(stored.lastSetup.length).toBeUndefined();
      // Version stamp updated.
      expect(stored.appSchemaVersion).toBe(APP_SCHEMA_VERSION);
      db.close();
    });

    it('maps an unknown legacy theme to the daily intent', async () => {
      const U = 'u_v2_theme' as UserId;
      const v1 = new LexiaDb(U, [SCHEMA_VERSIONS[0]!]);
      await v1.open();
      await v1.table('settings').put({
        userId: U,
        translationMode: 'off',
        fontScale: 1,
        voiceId: 'v',
        rate: 1,
        theme: 'system',
        locale: 'ja',
        lastSetup: { level: 'A2', themes: ['交渉'], newWordRatio: 0.3, length: 'short', targetWordIds: [], excludedWordIds: [] },
        appSchemaVersion: 1,
      } as never);
      v1.close();

      const db = new LexiaDb(U);
      await db.open();
      const stored = await db.settings.get(U);
      expect(stored?.lastSetup.intent).toBe('daily'); // unknown → daily fallback
      expect(stored?.lastSetup.wordTarget).toBe(200); // short → 200
      db.close();
    });

    it('provisions the stories store so confirmed plans can be persisted', async () => {
      const U = 'u_v2_stories' as UserId;
      const db = new LexiaDb(U);
      await db.open();
      const record = {
        storyId: 's1',
        userId: U,
        createdAt: 123,
        plan: {
          storyId: 's1',
          contentType: 'short_story' as const,
          genre: 'fantasy',
          titleJa: '物語',
          synopsisJa: 'あらすじ',
          characters: [],
          chapters: [{ index: 0, headingJa: '第一章', beatJa: 'ビート' }],
        },
      };
      await db.stories.put(record);
      expect(await db.stories.get('s1')).toEqual(record);
      db.close();
    });
  });
});

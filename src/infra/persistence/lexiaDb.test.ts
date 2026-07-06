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
import { DAY_MS } from '../../domain/srs/parameters';
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

    it('re-dates untouched legacy dueAt=0 New seeds to now+1day, leaving reviewed rows intact (A-1-2 / v3)', async () => {
      const U = 'u_v3_seed' as UserId;
      const before = Date.now();

      // Seed at v2 with the OLD passage-seed shape (dueAt: 0, reps: 0, no stability) plus a reviewed row.
      const v2 = new LexiaDb(U, [SCHEMA_VERSIONS[0]!, SCHEMA_VERSIONS[1]!]);
      await v2.open();
      expect(v2.verno).toBe(2);
      await v2.table('scheduling').put({
        userId: U,
        wordId: 'read-once',
        difficulty: 0,
        reps: 0,
        lapses: 0,
        learningStep: 0,
        lastReviewAt: 0,
        dueAt: 0,
        lastSource: 'passage',
        mastery: 'New',
        reappearCount: 0,
      } as never);
      await v2.table('scheduling').put({
        userId: U,
        wordId: 'reviewed',
        stability: 6,
        difficulty: 5,
        reps: 3,
        lapses: 0,
        learningStep: 0,
        lastReviewAt: 10,
        dueAt: 0, // reviewed yet coincidentally dueAt 0 — must NOT be touched (reps>0, stability defined)
        lastSource: 'review',
        mastery: 'Learning',
        reappearCount: 0,
      } as never);
      v2.close();

      // Reopen at the real latest schema (which now includes the v3 data-only correction).
      const db = new LexiaDb(U);
      await db.open();
      expect(db.verno).toBe(APP_SCHEMA_VERSION);
      expect(APP_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);

      const seed = await db.scheduling.get([U, 'read-once']);
      expect(seed?.dueAt).toBeGreaterThanOrEqual(before + DAY_MS); // re-dated to now+1day
      expect(seed?.stability).toBeUndefined(); // still New
      expect(seed?.mastery).toBe('New');
      expect(seed?.reps).toBe(0);

      const reviewed = await db.scheduling.get([U, 'reviewed']);
      expect(reviewed?.dueAt).toBe(0); // reviewed row untouched despite dueAt 0
      expect(reviewed?.stability).toBe(6);
      db.close();
    });

    it('back-fills ReadingProgress.lastOpenedAt from startedAt on the v4 migration (F-2)', async () => {
      const U = 'u_v4_progress' as UserId;

      // Seed at v3 (pre-F-2) with a progress row that has NO lastOpenedAt, plus one that already does.
      const v3 = new LexiaDb(U, [SCHEMA_VERSIONS[0]!, SCHEMA_VERSIONS[1]!, SCHEMA_VERSIONS[2]!]);
      await v3.open();
      expect(v3.verno).toBe(3);
      await v3.table('progress').put({
        userId: U,
        passageId: 'legacy',
        sentenceIndex: 3,
        percent: 40,
        status: 'in_progress',
        startedAt: 123,
        // lastOpenedAt intentionally absent (legacy row)
      } as never);
      await v3.table('progress').put({
        userId: U,
        passageId: 'already',
        sentenceIndex: 1,
        percent: 20,
        status: 'in_progress',
        startedAt: 100,
        lastOpenedAt: 999,
      } as never);
      v3.close();

      // Reopen at the real latest schema (which now includes the v4 back-fill).
      const db = new LexiaDb(U);
      await db.open();
      expect(db.verno).toBe(APP_SCHEMA_VERSION);
      expect(APP_SCHEMA_VERSION).toBeGreaterThanOrEqual(4);

      const legacy = await db.progress.get([U, 'legacy']);
      expect(legacy?.lastOpenedAt).toBe(123); // seeded from startedAt
      expect(legacy?.sentenceIndex).toBe(3); // invariant preserved

      const already = await db.progress.get([U, 'already']);
      expect(already?.lastOpenedAt).toBe(999); // existing value untouched
      db.close();
    });

    it('provisions the suggestionCache + audioClips stores on the v5 migration, re-stamping settings (E-3(c)/D5)', async () => {
      const U = 'u_v5_stores' as UserId;

      // Seed at v4 (pre-Phase-3) with a settings row so the v5 re-stamp has something to touch.
      const v4 = new LexiaDb(U, [SCHEMA_VERSIONS[0]!, SCHEMA_VERSIONS[1]!, SCHEMA_VERSIONS[2]!, SCHEMA_VERSIONS[3]!]);
      await v4.open();
      expect(v4.verno).toBe(4);
      await v4.table('settings').put({
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
        appSchemaVersion: 4,
      } as never);
      v4.close();

      // Reopen at the real latest schema (which now includes the additive v5 stores).
      const db = new LexiaDb(U);
      await db.open();
      expect(db.verno).toBe(APP_SCHEMA_VERSION);
      expect(APP_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);

      // New stores exist and round-trip.
      await db.suggestionCache.put({
        userId: U,
        suggestionKey: 'B1|daily',
        proposals: ['alpha', 'beta'],
        updatedAt: '2026-07-06T00:00:00.000Z',
      });
      expect((await db.suggestionCache.get([U, 'B1|daily']))?.proposals).toEqual(['alpha', 'beta']);

      const clip = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
      await db.audioClips.put({ userId: U, refType: 'word', refId: 'w1', voiceId: 'Joanna', blob: clip, updatedAt: '2026-07-06T00:00:00.000Z' });
      const storedClip = await db.audioClips.get([U, 'word', 'w1', 'Joanna']);
      expect(storedClip?.refType).toBe('word');
      expect(storedClip?.blob).toBeInstanceOf(Blob);
      expect(await storedClip!.blob.text()).toBe(await clip.text());

      // Settings row re-stamped to the latest schema version.
      expect((await db.settings.get(U))?.appSchemaVersion).toBe(APP_SCHEMA_VERSION);
      db.close();
    });

    it('lifts inline passage/story data URLs into the images table as blobs + refs, deduped (v5 / F-5 第3段)', async () => {
      const U = 'u_v5_images' as UserId;
      const SCENE = 'data:image/png;base64,AAAA'; // 3 zero bytes
      const CHAR = 'data:image/jpeg;base64,/9j/4AAQ'; // shared by portrait + full body

      // Seed at v4 (pre-image-separation) with an image-bearing passage, an image-less passage,
      // and a story whose character reuses one data URL for both portrait and full body.
      const v4 = new LexiaDb(U, SCHEMA_VERSIONS.slice(0, 4));
      await v4.open();
      expect(v4.verno).toBe(4);
      await v4.table('passages').put({
        passageId: 'p1',
        userId: U,
        createdAt: 111,
        passage: {
          meta: { title: 'T1', intent: 'daily', level: 'B1', approxWords: 0, sceneIllustrationUrl: SCENE },
          sentences: [],
          targetSpans: [],
          collocationSpans: [],
          noticeCues: [],
        },
      } as never);
      await v4.table('passages').put({
        passageId: 'p2',
        userId: U,
        createdAt: 112,
        passage: {
          meta: { title: 'T2', intent: 'daily', level: 'B1', approxWords: 0 },
          sentences: [],
          targetSpans: [],
          collocationSpans: [],
          noticeCues: [],
        },
      } as never);
      await v4.table('stories').put({
        storyId: 's1',
        userId: U,
        createdAt: 113,
        plan: {
          storyId: 's1',
          contentType: 'short_story',
          genre: 'fantasy',
          titleJa: 'x',
          synopsisJa: 'y',
          characters: [
            { name: 'A', role: 'hero', descriptionJa: 'd', portraitIllustrationUrl: CHAR, fullBodyIllustrationUrl: CHAR },
            { name: 'B', role: 'foe', descriptionJa: 'd' },
          ],
          chapters: [],
        },
      } as never);
      v4.close();

      // Reopen at the real latest schema (which now includes the v5 image migration).
      const db = new LexiaDb(U);
      await db.open();
      expect(db.verno).toBe(APP_SCHEMA_VERSION);
      expect(APP_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);

      const p1 = await db.passages.get('p1');
      expect(p1!.passage.meta.sceneIllustrationUrl).toMatch(/^lexia-image:/);
      const p2 = await db.passages.get('p2');
      expect(p2!.passage.meta.sceneIllustrationUrl).toBeUndefined(); // untouched

      const characters = (await db.stories.get('s1'))!.plan.characters;
      const charA = characters[0]!;
      expect(charA.portraitIllustrationUrl).toMatch(/^lexia-image:/);
      expect(charA.fullBodyIllustrationUrl).toMatch(/^lexia-image:/);
      // Identical data URL collapses onto one image so the portrait/full-body dedup check still holds.
      expect(charA.portraitIllustrationUrl).toBe(charA.fullBodyIllustrationUrl);
      expect(characters[1]!.portraitIllustrationUrl).toBeUndefined();

      // The images table holds the two distinct decoded blobs (scene + shared character).
      const images = await db.images.where('userId').equals(U).toArray();
      expect(images).toHaveLength(2);
      const charImage = await db.images.get(charA.portraitIllustrationUrl!.slice('lexia-image:'.length));
      expect(charImage?.blob).toBeInstanceOf(Blob);
      expect(charImage?.mime).toBe('image/jpeg');
      expect(charImage?.userId).toBe(U);
      const sceneImage = await db.images.get(p1!.passage.meta.sceneIllustrationUrl!.slice('lexia-image:'.length));
      expect(sceneImage?.mime).toBe('image/png');
      expect(await sceneImage!.blob.arrayBuffer()).toEqual(new Uint8Array([0, 0, 0]).buffer);
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

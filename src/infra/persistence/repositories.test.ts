import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LexiaDb } from './lexiaDb';
import { createRepositories } from './repositories';
import type { UserId, WordSchedulingState, ReadingProgress } from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

let dbSeq = 0;
async function freshDb(): Promise<{ db: LexiaDb; userId: UserId }> {
  const userId = `repo_${dbSeq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { db, userId };
}

function sched(
  userId: UserId,
  wordId: string,
  over: Partial<WordSchedulingState> = {},
): WordSchedulingState {
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

describe('SchedulingRepository', () => {
  it('round-trips via get/upsert', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).scheduling;
    const s = sched(userId, 'w1', { stability: 12 });
    await repo.upsert(s);
    expect(await repo.get(userId, 'w1')).toEqual(s);
    // upsert overwrites the same key.
    await repo.upsert({ ...s, stability: 20 });
    expect((await repo.get(userId, 'w1'))?.stability).toBe(20);
    db.close();
  });

  it('dueBefore returns due-soonest-first words at/before the cutoff', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).scheduling;
    await repo.upsert(sched(userId, 'a', { dueAt: 200 }));
    await repo.upsert(sched(userId, 'b', { dueAt: 50 }));
    await repo.upsert(sched(userId, 'c', { dueAt: 100 }));
    await repo.upsert(sched(userId, 'd', { dueAt: 999 })); // not due yet

    const due = await repo.dueBefore(userId, 150);
    expect(due.map((s) => s.wordId)).toEqual(['b', 'c']); // ascending dueAt, 'd' excluded
    db.close();
  });

  it('lowStability returns weakest-first and excludes New (unset stability) words', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).scheduling;
    await repo.upsert(sched(userId, 'strong', { stability: 30 }));
    await repo.upsert(sched(userId, 'weak', { stability: 2 }));
    await repo.upsert(sched(userId, 'mid', { stability: 10 }));
    const isNew = sched(userId, 'new', { mastery: 'New' });
    delete isNew.stability;
    await repo.upsert(isNew);

    const weak = await repo.lowStability(userId, 10);
    expect(weak.map((s) => s.wordId)).toEqual(['weak', 'mid', 'strong']); // ascending S, New excluded
    expect(await repo.lowStability(userId, 1)).toHaveLength(1);
    db.close();
  });
});

describe('ReviewLogRepository (append-only)', () => {
  it('appends entries and reads them back since a timestamp', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).reviewLog;
    await repo.append({ userId, wordId: 'w1', rating: 3, source: 'review', at: 10 });
    await repo.append({ userId, wordId: 'w1', rating: 1, source: 'passage', at: 20 });
    await repo.append({ userId, wordId: 'w2', rating: 4, source: 'review', at: 30 });

    const since = await repo.since(userId, 20);
    expect(since.map((e) => e.at)).toEqual([20, 30]);
    // append-only: the port exposes no update/delete.
    expect('update' in repo).toBe(false);
    expect('delete' in repo).toBe(false);
    db.close();
  });

  it('lastPassageUpdate returns the latest passage-origin timestamp for a word', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).reviewLog;
    await repo.append({ userId, wordId: 'w1', rating: 3, source: 'review', at: 5 });
    await repo.append({ userId, wordId: 'w1', rating: 2, source: 'passage', at: 40 });
    await repo.append({ userId, wordId: 'w1', rating: 2, source: 'passage', at: 25 });

    expect(await repo.lastPassageUpdate(userId, 'w1')).toBe(40);
    expect(await repo.lastPassageUpdate(userId, 'w2')).toBeUndefined();
    db.close();
  });
});

describe('PassageRepository', () => {
  it('stores passages and returns the most recent first', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).passages;
    const mk = (id: string, createdAt: number): PassageRecord => ({
      passageId: id,
      userId,
      createdAt,
      passage: {
        meta: { title: id, theme: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
        sentences: [],
        targetSpans: [],
        collocationSpans: [],
        noticeCues: [],
      },
    });
    await repo.put(mk('p1', 100));
    await repo.put(mk('p2', 300));
    await repo.put(mk('p3', 200));

    expect(await repo.get('p2')).toBeDefined();
    expect((await repo.recent(userId, 2)).map((p) => p.passageId)).toEqual(['p2', 'p3']);
    db.close();
  });
});

describe('TimingMapRepository', () => {
  it('overwrites idempotently per (passageId, voiceId)', async () => {
    const { db } = await freshDb();
    const repo = createRepositories(db).timingMaps;
    await repo.put({ passageId: 'p1', voiceId: 'joanna', marks: [{ tokenId: 'p1:0:0', startMs: 0, endMs: 100 }] });
    await repo.put({ passageId: 'p1', voiceId: 'joanna', marks: [] }); // re-synth overwrite
    const got = await repo.get('p1', 'joanna');
    expect(got?.marks).toHaveLength(0);
    expect(await repo.get('p1', 'matthew')).toBeUndefined();
    db.close();
  });
});

describe('ProgressRepository', () => {
  it('upserts and filters by status', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).progress;
    const mk = (id: string, status: ReadingProgress['status'], startedAt: number): ReadingProgress => ({
      userId,
      passageId: id,
      sentenceIndex: 0,
      percent: status === 'completed' ? 100 : 40,
      status,
      startedAt,
    });
    await repo.upsert(mk('p1', 'in_progress', 10));
    await repo.upsert(mk('p2', 'completed', 20));
    await repo.upsert(mk('p3', 'in_progress', 30));

    const inProgress = await repo.byStatus(userId, 'in_progress');
    expect(inProgress.map((p) => p.passageId)).toEqual(['p3', 'p1']); // most recent first
    expect(await repo.byStatus(userId, 'completed')).toHaveLength(1);
    db.close();
  });
});

describe('SettingsRepository', () => {
  it('stamps APP_SCHEMA_VERSION on write and returns domain Settings', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).settings;
    await repo.put({
      userId,
      translationMode: 'per_sentence',
      fontScale: 1.2,
      voiceId: 'joanna',
      rate: 1,
      theme: 'light',
      locale: 'ja',
      lastSetup: {
        level: 'B2',
        themes: ['travel'],
        newWordRatio: 0.3,
        length: 'medium',
        targetWordIds: ['w1'],
        excludedWordIds: [],
      },
    });
    const got = await repo.get(userId);
    expect(got?.translationMode).toBe('per_sentence');
    expect(got?.fontScale).toBe(1.2);
    // The persisted row carries the schema version even though the port returns Settings.
    const raw = await db.settings.get(userId);
    expect(raw?.appSchemaVersion).toBe(1);
    db.close();
  });
});

describe('WordCacheRepository', () => {
  it('caches word data per user and lists all', async () => {
    const { db, userId } = await freshDb();
    const repo = createRepositories(db).wordCache;
    const word = {
      wordId: 'w1',
      headword: 'resilient',
      ipa: '',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: [], synonymNuances: [] },
    };
    await repo.put(userId, word);
    expect((await repo.get(userId, 'w1'))?.headword).toBe('resilient');
    expect(await repo.all(userId)).toHaveLength(1);
    db.close();
  });
});

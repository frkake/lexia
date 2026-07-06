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
      lastOpenedAt: 70,
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
      lastSetup: { examTarget: { kind: 'eiken', value: '2' }, intent: 'travel', newWordRatio: 0.3, wordTarget: 200, contentType: 'article', targetWordIds: ['w1'], excludedWordIds: [] },
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

const passageRecord = {
  passageId: 'p1',
  userId: U,
  createdAt: 10,
  passage: {
    meta: { title: 'T', intent: 'daily' as const, level: 'B1' as const, approxWords: 5, sceneIllustrationUrl: 'lexia-image:i1' },
    sentences: [],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  },
};

const storyRecord = {
  storyId: 's1',
  userId: U,
  createdAt: 11,
  plan: {
    storyId: 's1',
    contentType: 'short_story' as const,
    genre: 'fantasy',
    titleJa: 'x',
    synopsisJa: 'y',
    characters: [{ name: 'A', role: 'hero', descriptionJa: 'd', portraitIllustrationUrl: 'lexia-image:i2' }],
    chapters: [],
  },
};

const wordRecord = {
  userId: U,
  wordId: 'w1',
  headword: 'run',
  ipa: '',
  pos: ['v'],
  register: '',
  connotation: '',
  frequency: 3,
  core: { meaningsJa: ['走る'], examples: [], collocations: [], synonymNuances: [] },
};

async function seedAssets(db: LexiaDb): Promise<void> {
  await db.passages.put(passageRecord as never);
  await db.stories.put(storyRecord as never);
  await db.wordCache.put(wordRecord as never);
  await db.images.put({ imageId: 'i1', userId: U, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), mime: 'image/png', createdAt: 1 });
  await db.images.put({ imageId: 'i2', userId: U, blob: new Blob([new Uint8Array([9, 8])], { type: 'image/jpeg' }), mime: 'image/jpeg', createdAt: 2 });
}

describe('JsonSyncAdapter v2 (assets + images)', () => {
  it('round-trips passages, stories, wordCache and image blobs into a fresh namespace', async () => {
    const dbA = await openDb('v2_src');
    await seedAssets(dbA);

    const blob = await new JsonSyncAdapter(dbA).export(U);
    const parsed = JSON.parse(await blob.text());
    expect(parsed.formatVersion).toBe(2);
    expect(parsed.images).toHaveLength(2);

    const dbB = await openDb('v2_dst');
    await new JsonSyncAdapter(dbB).import(U, blob);

    expect(await dbB.passages.get('p1')).toEqual(passageRecord);
    expect(await dbB.stories.get('s1')).toEqual(storyRecord);
    expect((await dbB.wordCache.get([U, 'w1']))?.headword).toBe('run');

    const img1 = await dbB.images.get('i1');
    expect(img1?.mime).toBe('image/png');
    expect(img1?.userId).toBe(U);
    expect(new Uint8Array(await img1!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(await (await dbB.images.get('i2'))!.blob.arrayBuffer())).toEqual(new Uint8Array([9, 8]));

    dbA.close();
    dbB.close();
  });

  it('excludes images and null-outs image references when includeImages is false (smaller file)', async () => {
    const dbA = await openDb('v2_noimg_src');
    await seedAssets(dbA);
    const adapter = new JsonSyncAdapter(dbA);

    const withImages = await adapter.export(U, { includeImages: true });
    const withoutImages = await adapter.export(U, { includeImages: false });
    expect(withoutImages.size).toBeLessThan(withImages.size);

    const parsed = JSON.parse(await withoutImages.text());
    expect(parsed.images).toHaveLength(0);
    expect(parsed.passages[0].passage.meta.sceneIllustrationUrl).toBeUndefined();
    expect(parsed.stories[0].plan.characters[0].portraitIllustrationUrl).toBeUndefined();

    // Importing a text-only backup restores the records (without illustrations) and touches no images.
    const dbB = await openDb('v2_noimg_dst');
    await new JsonSyncAdapter(dbB).import(U, withoutImages);
    expect((await dbB.passages.get('p1'))?.passage.meta.sceneIllustrationUrl).toBeUndefined();
    expect(await dbB.images.count()).toBe(0);

    dbA.close();
    dbB.close();
  });

  it('accepts a legacy v1 payload (no assets/images) without error', async () => {
    const v1Payload = {
      formatVersion: 1,
      userId: String(U),
      scheduling: [sched('w1')],
      reviewLog: [{ userId: U, wordId: 'w1', rating: 3, source: 'review' as const, at: 100 }],
      progress: [],
      settings: [],
    };
    const blob = new Blob([JSON.stringify(v1Payload)], { type: 'application/json' });

    const dbB = await openDb('v1_compat_dst');
    await new JsonSyncAdapter(dbB).import(U, blob);
    expect((await dbB.scheduling.get([U, 'w1']))?.stability).toBe(12);
    expect(await dbB.passages.count()).toBe(0);
    expect(await dbB.images.count()).toBe(0);
    dbB.close();
  });
});

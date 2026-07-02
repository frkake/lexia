// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { restoreReadingSession, hydrateSettings } from './sessionBootstrap';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { createSessionStore } from '../stores/sessionStore';
import { createSettingsStore } from '../stores/settingsStore';
import type { PassageOutput, Settings, UserId } from '../../types/domain';

let seq = 0;
async function freshEnv() {
  const userId = `boot_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { db, repos: createRepositories(db), userId };
}

function passageOutput(): PassageOutput {
  return {
    meta: { title: '続きの物語', intent: 'business', level: 'B2', newCount: 0, reviewCount: 2, approxWords: 8 },
    sentences: [
      { tokens: ['First', 'sentence', '.'], translationJa: '一文目。' },
      { tokens: ['Second', 'sentence', 'here', '.'], translationJa: '二文目。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

describe('restoreReadingSession (revisit restore, task 10.4)', () => {
  it('reopens the last in-progress passage at its saved position', async () => {
    const { repos, userId } = await freshEnv();
    const session = createSessionStore();
    await repos.passages.put({ passageId: 'pX', userId, createdAt: 100, passage: passageOutput() });
    await repos.progress.upsert({
      userId,
      passageId: 'pX',
      sentenceIndex: 1,
      percent: 50,
      status: 'in_progress',
      startedAt: 100,
    });

    const restored = await restoreReadingSession({ passages: repos.passages, progress: repos.progress, session }, userId);

    expect(restored?.passageId).toBe('pX');
    const s = session.getState();
    expect(s.passage?.passageId).toBe('pX');
    expect(s.sentenceIndex).toBe(1);
    expect(s.percent).toBe(100); // 2 of 2 sentences read
    expect(s.status).toBe('in_progress');
  });

  it('returns null when there is nothing in progress', async () => {
    const { repos, userId } = await freshEnv();
    const session = createSessionStore();
    const restored = await restoreReadingSession({ passages: repos.passages, progress: repos.progress, session }, userId);
    expect(restored).toBeNull();
    expect(session.getState().passage).toBeNull();
  });
});

describe('hydrateSettings (revisit restore of preferences, task 10.4)', () => {
  it('restores persisted display settings into the store', async () => {
    const { repos, userId } = await freshEnv();
    const stored: Settings = {
      userId,
      translationMode: 'per_sentence',
      fontScale: 1.3,
      voiceId: 'Matthew',
      rate: 1.25,
      theme: 'dark',
      locale: 'ja',
      lastSetup: { examTarget: { kind: 'eiken', value: '1' }, intent: 'business', newWordRatio: 0.2, wordTarget: 800, contentType: 'article', targetWordIds: ['x'], excludedWordIds: [] },
    };
    await repos.settings.put(stored);

    const store = createSettingsStore({ storage: memStorage() });
    await hydrateSettings(store, repos.settings, userId);

    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.fontScale).toBe(1.3);
    expect(s.translationMode).toBe('per_sentence');
    expect(s.voiceId).toBe('Matthew');
    expect(s.lastSetup.examTarget).toEqual({ kind: 'eiken', value: '1' });
  });
});

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

import { openPassage } from './sessionBootstrap';
import type { PassageRepository, PassageRecord, ProgressRepository } from '../../types/ports';
import type { ReadingProgress } from '../../types/domain';

function record(passageId: string, userId: string): PassageRecord {
  const passage: PassageOutput = {
    meta: { title: 'T', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [
      { tokens: ['One', '.'], translationJa: '一。' },
      { tokens: ['Two', '.'], translationJa: '二。' },
      { tokens: ['Three', '.'], translationJa: '三。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return { passageId, userId: userId as UserId, createdAt: 1, passage };
}

function deps(records: PassageRecord[], progress: ReadingProgress[] = []) {
  const passages: Pick<PassageRepository, 'get'> = {
    async get(id) {
      return records.find((r) => r.passageId === id);
    },
  };
  const progressRepo: Pick<ProgressRepository, 'get'> = {
    async get(userId, passageId) {
      return progress.find((p) => p.userId === userId && p.passageId === passageId);
    },
  };
  return {
    passages: passages as PassageRepository,
    progress: progressRepo as ProgressRepository,
    session: createSessionStore(),
  };
}

describe('openPassage', () => {
  it('loads a passage into the session and restores the saved sentence position', async () => {
    const d = deps(
      [record('p1', 'u')],
      [{ userId: 'u' as UserId, passageId: 'p1', sentenceIndex: 2, percent: 100, status: 'in_progress', startedAt: 1 }],
    );
    const result = await openPassage(d, 'u' as UserId, 'p1');
    expect(result?.passageId).toBe('p1');
    expect(d.session.getState().passage?.passageId).toBe('p1');
    expect(d.session.getState().sentenceIndex).toBe(2);
  });

  it('starts at sentence 0 when there is no saved progress', async () => {
    const d = deps([record('p1', 'u')]);
    await openPassage(d, 'u' as UserId, 'p1');
    expect(d.session.getState().sentenceIndex).toBe(0);
  });

  it('returns null for an unknown passage and leaves the session untouched', async () => {
    const d = deps([record('p1', 'u')]);
    const result = await openPassage(d, 'u' as UserId, 'missing');
    expect(result).toBeNull();
    expect(d.session.getState().passage).toBeNull();
  });

  it('returns null when the passage belongs to another user', async () => {
    const d = deps([record('p1', 'other')]);
    const result = await openPassage(d, 'u' as UserId, 'p1');
    expect(result).toBeNull();
  });
});

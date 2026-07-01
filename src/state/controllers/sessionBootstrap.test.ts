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

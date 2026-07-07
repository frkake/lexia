import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createSettingsStore, THEME_KEY, LOCALE_KEY } from './settingsStore';
import type { KeyValueStorage } from './settingsStore';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { DexieSettingsRepository } from '../../infra/persistence/settingsRepository';
import type { UserId } from '../../types/domain';

const flush = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

let seq = 0;
async function freshRepo(): Promise<{ repo: DexieSettingsRepository; userId: UserId }> {
  const userId = `settings_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { repo: new DexieSettingsRepository(db), userId };
}

describe('settingsStore', () => {
  it('persists repository-backed settings on change', async () => {
    const { repo, userId } = await freshRepo();
    const store = createSettingsStore({ storage: memoryStorage() });
    store.getState().configure(repo, userId);

    store.getState().setTranslationMode('full');
    store.getState().setFontScale(1.3);
    store.getState().setRate(1.25);
    await flush();

    const persisted = await repo.get(userId);
    expect(persisted?.translationMode).toBe('full');
    expect(persisted?.fontScale).toBe(1.3);
    expect(persisted?.rate).toBe(1.25);
  });

  it('writes theme and locale to localStorage synchronously for FOUC avoidance', () => {
    const storage = memoryStorage();
    const store = createSettingsStore({ storage });
    store.getState().setTheme('dark');
    store.getState().setLocale('en');
    expect(storage.getItem(THEME_KEY)).toBe('dark');
    expect(storage.getItem(LOCALE_KEY)).toBe('en');
    expect(store.getState().theme).toBe('dark');
  });

  it('restores persisted settings on revisit, preferring localStorage for theme/locale', async () => {
    const { repo, userId } = await freshRepo();
    // Seed the repository as a prior session would have.
    await repo.put({
      userId,
      translationMode: 'per_sentence',
      fontScale: 1.2,
      voiceId: 'matthew',
      rate: 1.5,
      theme: 'light',
      locale: 'ja',
      lastSetup: { examTarget: { kind: 'eiken', value: '準1' }, intent: 'business', newWordRatio: 0.4, wordTarget: 800, contentType: 'article', targetWordIds: ['w9'], excludedWordIds: [] },
    });

    const storage = memoryStorage({ [THEME_KEY]: 'dark', [LOCALE_KEY]: 'en' });
    const store = createSettingsStore({ storage });
    store.getState().configure(repo, userId);
    await store.getState().hydrate();

    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.translationMode).toBe('per_sentence');
    expect(s.voiceId).toBe('matthew');
    expect(s.lastSetup.examTarget).toEqual({ kind: 'eiken', value: '準1' });
    // theme/locale come from the synchronous localStorage source.
    expect(s.theme).toBe('dark');
    expect(s.locale).toBe('en');
  });

  it('defaults generationMode to staged, persists changes, and hydrates a stored batch preference', async () => {
    const { repo, userId } = await freshRepo();
    const store = createSettingsStore({ storage: memoryStorage() });
    store.getState().configure(repo, userId);
    await store.getState().hydrate();
    expect(store.getState().generationMode).toBe('staged');

    store.getState().setGenerationMode('batch');
    expect(store.getState().generationMode).toBe('batch');
    await store.getState().persist();
    expect((await repo.get(userId))?.generationMode).toBe('batch');

    // A fresh session hydrates the stored preference.
    const revisit = createSettingsStore({ storage: memoryStorage() });
    revisit.getState().configure(repo, userId);
    await revisit.getState().hydrate();
    expect(revisit.getState().generationMode).toBe('batch');
  });
});

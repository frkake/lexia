/**
 * L3 — settingsStore: holds display/preferences (translation mode, font scale, voice,
 * rate, theme, locale, lastSetup) and persists them (design.md "settingsStore", 5.1,
 * 13.3/13.4). theme/locale are mirrored to localStorage for a synchronous, FOUC-free
 * read at startup; everything (a complete Settings row) is also written to the
 * SettingsRepository so export/sync stays whole and revisits restore prior state.
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DAILY_REVIEW_LIMIT } from '../../domain/srs/parameters';
import type { SettingsRepository } from '../../types/ports';
import type { Settings, SetupConfig, UserId } from '../../types/domain';

/** Per-day review-card ceiling is settable within these bounds (learning-policy.md 設定値表). */
export const DAILY_REVIEW_LIMIT_MIN = 20;
export const DAILY_REVIEW_LIMIT_MAX = 200;

export const THEME_KEY = 'lexia.theme';
export const LOCALE_KEY = 'lexia.locale';

/** Minimal localStorage surface (injectable for tests / SSR safety). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULT_SETUP: SetupConfig = {
  examTarget: { kind: 'eiken', value: '2' }, // 英検2級 ≒ CEFR B1 (mid default)
  intent: 'daily',
  newWordRatio: 0.3,
  wordTarget: 400,
  contentType: 'article',
  listeningOptions: { sceneKind: 'radio_news', noiseLevel: 'low', accent: 'gb' },
  targetWordIds: [],
  excludedWordIds: [],
};

export interface SettingsState {
  ready: boolean;
  translationMode: Settings['translationMode'];
  fontScale: number;
  voiceId: string;
  rate: number;
  theme: Settings['theme'];
  locale: string;
  lastSetup: SetupConfig;
  /** Per-day review-card ceiling (C-5c); default `DAILY_REVIEW_LIMIT`, settable 20–200. */
  dailyReviewLimit: number;

  /** Bind the repository + namespace (after the DB opens). */
  configure(repo: SettingsRepository, userId: UserId): void;
  /** Load persisted settings; theme/locale prefer the synchronous localStorage read. */
  hydrate(): Promise<void>;
  /** Write the current full Settings row to the repository. */
  persist(): Promise<void>;

  setTranslationMode(mode: Settings['translationMode']): void;
  setFontScale(scale: number): void;
  setVoice(voiceId: string): void;
  setRate(rate: number): void;
  setLastSetup(setup: SetupConfig): void;
  setTheme(theme: Settings['theme']): void;
  setLocale(locale: string): void;
  /** Set the per-day review ceiling; the value is clamped to [20, 200]. */
  setDailyReviewLimit(limit: number): void;
}

export interface SettingsStoreDeps {
  storage?: KeyValueStorage;
}

function resolveStorage(injected?: KeyValueStorage): KeyValueStorage | null {
  if (injected) return injected;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(deps: SettingsStoreDeps = {}) {
  const storage = resolveStorage(deps.storage);

  return createStore<SettingsState>()((set, get) => {
    let repo: SettingsRepository | null = null;
    let userId: UserId | null = null;

    /** Build the complete Settings row from current state. */
    const snapshot = (): Settings | null => {
      if (!userId) return null;
      const s = get();
      return {
        userId,
        translationMode: s.translationMode,
        fontScale: s.fontScale,
        voiceId: s.voiceId,
        rate: s.rate,
        theme: s.theme,
        locale: s.locale,
        lastSetup: s.lastSetup,
        dailyReviewLimit: s.dailyReviewLimit,
      };
    };

    const persist = async (): Promise<void> => {
      const row = snapshot();
      if (repo && row) await repo.put(row);
    };

    /** Update repo-backed fields then fire-and-forget the write. */
    const update = (patch: Partial<SettingsState>): void => {
      set(patch);
      void persist();
    };

    return {
      ready: false,
      translationMode: 'off',
      fontScale: 1,
      voiceId: '',
      rate: 1,
      theme: 'system',
      locale: 'ja',
      lastSetup: DEFAULT_SETUP,
      dailyReviewLimit: DAILY_REVIEW_LIMIT,

      configure(nextRepo, nextUserId) {
        repo = nextRepo;
        userId = nextUserId;
      },

      async hydrate() {
        const stored = repo && userId ? await repo.get(userId) : undefined;
        const theme = (storage?.getItem(THEME_KEY) as Settings['theme'] | null) ?? stored?.theme ?? get().theme;
        const locale = storage?.getItem(LOCALE_KEY) ?? stored?.locale ?? get().locale;
        set({
          ready: true,
          theme,
          locale,
          ...(stored
            ? {
                translationMode: stored.translationMode,
                fontScale: stored.fontScale,
                voiceId: stored.voiceId,
                rate: stored.rate,
                lastSetup: stored.lastSetup,
                ...(stored.dailyReviewLimit !== undefined ? { dailyReviewLimit: stored.dailyReviewLimit } : {}),
              }
            : {}),
        });
      },

      persist,

      setTranslationMode(mode) {
        update({ translationMode: mode });
      },
      setFontScale(scale) {
        update({ fontScale: scale });
      },
      setVoice(voiceId) {
        update({ voiceId });
      },
      setRate(rate) {
        update({ rate });
      },
      setLastSetup(setup) {
        update({ lastSetup: setup });
      },

      setTheme(theme) {
        storage?.setItem(THEME_KEY, theme); // synchronous (FOUC avoidance)
        update({ theme });
      },
      setLocale(locale) {
        storage?.setItem(LOCALE_KEY, locale);
        update({ locale });
      },
      setDailyReviewLimit(limit) {
        const clamped = Math.round(Math.min(DAILY_REVIEW_LIMIT_MAX, Math.max(DAILY_REVIEW_LIMIT_MIN, limit)));
        update({ dailyReviewLimit: clamped });
      },
    };
  });
}

/** App-wide singleton settings store. */
export const settingsStore = createSettingsStore();

export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

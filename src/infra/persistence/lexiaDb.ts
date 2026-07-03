/**
 * L2 — LexiaDB: the local-first system-of-record (Dexie / IndexedDB).
 *
 * One database per learner, named `lexia_<userId>` (`anonymous` before sign-in,
 * migrated on first sign-in). Numbered migrations via `version(n).stores().upgrade()`;
 * the latest declared version is APP_SCHEMA_VERSION and is mirrored into the settings
 * store. Audio/illustration blobs are normally never stored — only external URL references. The
 * deliberate image exceptions have no CDN, so they are stored inline as base64 `data:` URLs:
 * story character illustrations in `StoryRecord.plan.characters[].illustrationUrl` and passage
 * scene illustrations in `PassageOutput.meta.sceneIllustrationUrl`.
 */

import Dexie, { type Table, type Transaction } from 'dexie';
import type { PassageRecord } from '../../types/ports';
import type {
  UserId,
  WordSchedulingState,
  ReviewLogEntry,
  TimingMap,
  ReadingProgress,
  Settings,
  StoryRecord,
  WordData,
} from '../../types/domain';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import { cefrToDefaultExam } from '../../domain/difficulty/examScale';
import type { Cefr, LearningIntent } from '../../types/domain';

/** Settings row persisted with the schema version it was written under. */
export interface StoredSettings extends Settings {
  appSchemaVersion: number;
}

/** Word-data cache row (adds the namespacing userId to the external WordData). */
export interface WordCacheRecord extends WordData {
  userId: UserId;
}

/** One numbered migration step. `stores` need only declare changed tables. */
export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => void | PromiseLike<unknown>;
}

/**
 * Ordered schema history. Append a new entry (never edit a shipped one) to migrate.
 * Indexes chosen to back the hot queries: scheduling.dueAt ("today's review"),
 * scheduling.stability (candidate selection), reviewLog.at + [userId+wordId]
 * (append-only replay / cooldown), progress.status (dashboard).
 */
/** Coarse mapping of a legacy free-text theme tag onto the closed LearningIntent enum. */
function legacyThemeToIntent(themes: unknown): LearningIntent {
  const first = Array.isArray(themes) && typeof themes[0] === 'string' ? themes[0].toLowerCase() : '';
  const known: Record<string, LearningIntent> = {
    business: 'business',
    daily: 'daily',
    toeic: 'toeic',
    eiken: 'eiken',
    academic: 'academic',
    travel: 'travel',
  };
  return known[first] ?? 'daily'; // unknown (incl. Japanese tags) → daily
}

/**
 * Convert a legacy (v1) `lastSetup` — `{ level, themes, length }` — into the new SetupConfig shape
 * (`examTarget` / `intent` / `wordTarget` / `contentType`). Best-effort seed; strict fidelity is not
 * required (it only seeds the setup form). Idempotent: an already-migrated row passes through.
 */
function migrateLastSetup(raw: unknown): Record<string, unknown> {
  const setup = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (!('examTarget' in setup) && 'level' in setup) {
    setup.examTarget = cefrToDefaultExam((setup.level as Cefr) ?? 'B1');
  }
  if (!('intent' in setup)) {
    setup.intent = legacyThemeToIntent(setup.themes);
  }
  if (!('wordTarget' in setup) && 'length' in setup) {
    const legacy = setup.length;
    setup.wordTarget =
      legacy === 'short' || legacy === 'medium' || legacy === 'long' ? lengthSpec.migrateLegacyLength(legacy) : 400;
  }
  if (!('contentType' in setup)) setup.contentType = 'article';
  if (!Array.isArray(setup.targetWordIds)) setup.targetWordIds = [];
  if (!Array.isArray(setup.excludedWordIds)) setup.excludedWordIds = [];
  delete setup.level;
  delete setup.themes;
  delete setup.length;
  return setup;
}

export const SCHEMA_VERSIONS: SchemaVersion[] = [
  {
    version: 1,
    stores: {
      scheduling: '[userId+wordId], userId, dueAt, stability, mastery',
      reviewLog: '++id, [userId+wordId], at',
      passages: 'passageId, userId, passage.meta.theme, createdAt',
      timingMaps: '[passageId+voiceId], passageId',
      progress: '[userId+passageId], userId, status, completedAt',
      settings: 'userId',
      wordCache: '[userId+wordId], userId',
    },
  },
  {
    // v2 (learning-experience-overhaul): convert saved settings to the new SetupConfig shape,
    // replace the passages theme index with an intent index (+ story link), and add the stories
    // store for confirmed story plans. Additive — v1 above is never edited.
    version: 2,
    stores: {
      // theme → intent index; add story-link index (article passages leave it undefined).
      passages: 'passageId, userId, passage.meta.intent, passage.meta.storyRef.storyId, createdAt',
      stories: 'storyId, userId, createdAt',
    },
    upgrade: async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          row.lastSetup = migrateLastSetup(row.lastSetup);
          row.appSchemaVersion = 2;
        });
    },
  },
];

/** The latest declared schema version; kept in sync with Dexie's version. */
export const APP_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1]!.version;

/** IndexedDB database name for a given learner namespace. */
export function dbName(userId: string): string {
  return `lexia_${userId}`;
}

export class LexiaDb extends Dexie {
  scheduling!: Table<WordSchedulingState, [UserId, string]>;
  reviewLog!: Table<ReviewLogEntry, number>;
  passages!: Table<PassageRecord, string>;
  timingMaps!: Table<TimingMap, [string, string]>;
  progress!: Table<ReadingProgress, [UserId, string]>;
  settings!: Table<StoredSettings, UserId>;
  wordCache!: Table<WordCacheRecord, [UserId, string]>;
  stories!: Table<StoryRecord, string>;

  /**
   * @param userId  learner namespace (`anonymous` before sign-in)
   * @param versions migration history (injectable for migration tests)
   */
  constructor(userId: string, versions: SchemaVersion[] = SCHEMA_VERSIONS) {
    super(dbName(userId));
    for (const v of versions) {
      const versioned = this.version(v.version).stores(v.stores);
      if (v.upgrade) versioned.upgrade(v.upgrade);
    }
  }
}

/**
 * Ask the browser to keep storage durable (resist iOS eviction). Resolves false
 * when the Storage API is unavailable (e.g. Node/test) rather than throwing.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return false;
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Open (creating/migrating) a learner's database and request durable storage. */
export async function openLexiaDb(userId: string): Promise<LexiaDb> {
  const db = new LexiaDb(userId);
  await db.open();
  await requestPersistentStorage();
  return db;
}

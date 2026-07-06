/**
 * L2 — LexiaDB: the local-first system-of-record (Dexie / IndexedDB).
 *
 * One database per learner, named `lexia_<userId>` (`anonymous` before sign-in,
 * migrated on first sign-in). Numbered migrations via `version(n).stores().upgrade()`;
 * the latest declared version is APP_SCHEMA_VERSION and is mirrored into the settings
 * store. Audio/illustration blobs are normally never stored — only external URL references. The
 * deliberate image exceptions have no CDN: since F-5 第3段 (design decision D7) they live as Blobs in
 * the `images` table and the records reference them by `lexia-image:<imageId>` (story character
 * illustrations in `StoryRecord.plan.characters[]`, passage scene illustrations in
 * `PassageOutput.meta.sceneIllustrationUrl`). The v5 migration lifts any legacy inline base64 `data:`
 * URLs into that table; the display side resolves refs via `AssetImage` and passes legacy URLs through.
 */

import Dexie, { type Table, type Transaction } from 'dexie';
import type { ImageRecord, PassageRecord } from '../../types/ports';
import { dataUrlToBlob, imageRef } from './imageStore';
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
import { DAY_MS } from '../../domain/srs/parameters';
import { cefrToDefaultExam } from '../../domain/difficulty/examScale';
import type { Cefr, LearningIntent } from '../../types/domain';

/** Settings row persisted with the schema version it was written under. */
export interface StoredSettings extends Settings {
  appSchemaVersion: number;
}

/**
 * Current WordData cache contract version (design decision D2). Bumped when the WordData shape
 * changes: cached rows written under an older version are lifted on read and re-enriched in the
 * background rather than forcing a synchronous regeneration. `undefined` on a stored row means it
 * predates versioning and is treated as v1.
 *
 * v2 (Phase 3 C-1/2/3): structured collocations (CollocationEntry) / idioms (IdiomEntry) / etymology
 * (EtymologyV2) / semanticNetwork (SemanticNeighbor). v1 rows are lifted by `liftWordData` and
 * re-enriched (the lift leaves the new-only fields — originJa, slotExamples, part meaningJa — blank
 * until a fresh fetch fills them).
 */
export const WORD_DATA_SCHEMA_VERSION = 2;

/**
 * Word-data cache row (adds the namespacing userId to the external WordData). `schemaVersion` and
 * `enrichmentPending` are non-indexed cache metadata (no Dexie migration needed): the version the
 * row was written under, and whether the stored data still falls short of the current contract and
 * should be refreshed in the background.
 */
export interface WordCacheRecord extends WordData {
  userId: UserId;
  schemaVersion?: number;
  enrichmentPending?: boolean;
}

/**
 * Cached word-suggestion pool (E-3(c)). One row per learner × suggestion key (`${level}|${intent}`).
 * `proposals` is the raw list of new-word lemmas the suggestion LLM returned for that key; the SRS
 * merge (review pool / daily new-word clamp / exclusion filter) is re-run live on every read, so only
 * the genuinely expensive, slowly-changing LLM proposal set is cached here. Shared by the setup
 * preview and generation-time auto-selection so a given (level, intent) hits the LLM once per TTL
 * (`updatedAt` drives the 24h freshness window in WordSuggestionService).
 */
export interface SuggestionCacheRecord {
  userId: UserId;
  suggestionKey: string;
  proposals: string[];
  updatedAt: string; // ISO
}

/**
 * Synthesized-audio clip cache (E-3(g), forward-declared). Accumulates passage / word TTS blobs keyed
 * by `[userId+refType+refId+voiceId]`. IndexedDB stores Blobs directly. Defined now so the receiving
 * table exists ahead of the TTS backend (`/api/tts:*`) that will populate it; unused until then.
 */
export interface AudioClipRecord {
  userId: UserId;
  refType: 'passage' | 'word';
  refId: string; // passageId or wordId
  voiceId: string;
  blob: Blob;
  updatedAt: string; // ISO
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

/**
 * F-5 第3段 migration: move inline base64 `data:` illustration URLs off the passage/story records and
 * into the `images` table, replacing each with a `lexia-image:<imageId>` reference. Runs inside the v5
 * upgrade transaction. Idempotent: already-migrated refs (and external http URLs) are left untouched,
 * and a value that fails to decode stays inline so it is never lost.
 */
async function migrateInlineImages(tx: Transaction): Promise<void> {
  const images = tx.table('images');
  // Collapse identical inline data URLs onto a single stored image so the portrait/full-body dedup
  // checks (`portraitUrl === fullBodyIllustrationUrl`) still hold after the fields become refs.
  const seen = new Map<string, string>();

  const stash = async (
    src: unknown,
    userId: unknown,
    imageId: string,
    createdAt: number,
  ): Promise<string | undefined> => {
    if (typeof src !== 'string') return src as undefined;
    const decoded = dataUrlToBlob(src);
    if (!decoded) return src; // ref / http URL / undecodable — keep as-is
    const existing = seen.get(src);
    if (existing) return existing;
    const record: ImageRecord = {
      imageId,
      userId: (userId ?? 'anonymous') as UserId,
      blob: decoded.blob,
      mime: decoded.mime,
      createdAt,
    };
    await images.add(record);
    const ref = imageRef(imageId);
    seen.set(src, ref);
    return ref;
  };

  const passages = await tx.table('passages').toArray();
  for (const record of passages as PassageRecord[]) {
    const meta = record.passage?.meta as unknown as Record<string, unknown> | undefined;
    if (!meta || typeof meta.sceneIllustrationUrl !== 'string' || !meta.sceneIllustrationUrl.startsWith('data:')) {
      continue;
    }
    meta.sceneIllustrationUrl = await stash(
      meta.sceneIllustrationUrl,
      record.userId,
      `img_${record.passageId}_scene`,
      record.createdAt ?? Date.now(),
    );
    await tx.table('passages').put(record);
  }

  const stories = await tx.table('stories').toArray();
  for (const record of stories as StoryRecord[]) {
    const characters = record.plan?.characters;
    if (!Array.isArray(characters)) continue;
    let changed = false;
    for (let i = 0; i < characters.length; i += 1) {
      const character = characters[i] as unknown as Record<string, unknown>;
      for (const field of ['illustrationUrl', 'portraitIllustrationUrl', 'fullBodyIllustrationUrl'] as const) {
        if (typeof character[field] === 'string' && (character[field] as string).startsWith('data:')) {
          character[field] = await stash(
            character[field],
            record.userId,
            `img_${record.storyId}_c${i}_${field}`,
            record.createdAt ?? Date.now(),
          );
          changed = true;
        }
      }
    }
    if (changed) await tx.table('stories').put(record);
  }
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
  {
    // v3 (A-1-2 / design decision D1): data-only correction — no schema/index change. Legacy
    // passage seeds were written with `dueAt: 0`, permanently marking every merely-read word as
    // "due" (queue + dashboard inflation). Re-date the *untouched* New seeds (dueAt===0, reps===0,
    // stability===undefined) to `now + 1 day` so they re-surface as next-day re-weaving candidates
    // instead. Reviewed words (reps>0 or a defined stability) are left exactly as-is.
    version: 3,
    stores: {},
    upgrade: async (tx) => {
      const dueAt = Date.now() + DAY_MS;
      await tx
        .table('scheduling')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          if (row.dueAt === 0 && row.reps === 0 && row.stability === undefined) {
            row.dueAt = dueAt;
          }
        });
      // Keep the settings row's recorded schema version in step with the migrated data.
      await tx
        .table('settings')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          row.appSchemaVersion = 3;
        });
    },
  },
  {
    // v4 (Phase 2 aggregate migration, design decision D5). ALL Phase 2 schema/data changes land in
    // this single version — extend the `stores`/`upgrade` below rather than adding a v5.
    //   - F-2: `ReadingProgress.lastOpenedAt` (non-indexed) drives the newest-opened "続きを読む"
    //     ordering; back-fill legacy rows from `startedAt` so the sort is well-defined immediately.
    //   - C-5b: `WordSchedulingState.seededAt` (non-indexed) records when a New word was introduced,
    //     powering the DAILY_NEW_WORD_LIMIT clamp. No back-fill: legacy seeds correctly read as
    //     `undefined` (they predate today, so they never inflate the current day's new-word tally),
    //     and their original seed time cannot be recovered without risking a false "seeded today".
    //   - C-5d: `WordSchedulingState.suspended` (non-indexed) marks a「もう覚えた」known word. No
    //     schema/index change and no back-fill — absent reads as active; the flag is just persisted
    //     with the row and cleared on「復習に戻す」.
    version: 4,
    stores: {},
    upgrade: async (tx) => {
      // F-2: seed lastOpenedAt for progress rows written before the field existed.
      await tx
        .table('progress')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          if (row.lastOpenedAt === undefined) {
            row.lastOpenedAt = typeof row.startedAt === 'number' ? row.startedAt : 0;
          }
        });
      // Keep the settings row's recorded schema version in step with the migrated data.
      await tx
        .table('settings')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          row.appSchemaVersion = 4;
        });
    },
  },
  {
    // v5 (Phase 3 統合バージョン, design decision D5). ALL Phase 3 schema additions land in this single
    // version — extend the `stores` below rather than adding a v6.
    //   - E-3(c): `suggestionCache` — cached suggestion-LLM proposal pools keyed per (level, intent).
    //   - E-3(g, forward-declared): `audioClips` — TTS blob cache; table only, populated once the TTS
    //     backend ships.
    //   - F-5 第3段 (image Blob 分離, design decision D7): `images` — illustration Blob store. Records
    //     reference bytes by `lexia-image:<imageId>`; the upgrade lifts existing inline `data:` URLs on
    //     passages/stories into this table. New tables are purely additive; the only data change is the
    //     inline-image migration + the usual settings re-stamp.
    version: 5,
    stores: {
      suggestionCache: '[userId+suggestionKey], userId, updatedAt',
      audioClips: '[userId+refType+refId+voiceId], userId, updatedAt',
      images: 'imageId, userId, createdAt',
    },
    upgrade: async (tx) => {
      await migrateInlineImages(tx);
      await tx
        .table('settings')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          row.appSchemaVersion = 5;
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
  suggestionCache!: Table<SuggestionCacheRecord, [UserId, string]>;
  audioClips!: Table<AudioClipRecord, [UserId, string, string, string]>;
  images!: Table<ImageRecord, string>;

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

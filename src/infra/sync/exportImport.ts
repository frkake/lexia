/**
 * L2 — JsonSyncAdapter: the SyncAdapter seam (design.md "SyncAdapter", 13.4). Exports the learner's
 * recoverable state as a single JSON Blob and imports it back, re-stamping the target namespace. This
 * is the local backup/restore shim; real cloud sync is future work.
 *
 * SYNC_FORMAT_VERSION 2 (F-5 第2段) added the learning ASSETS — passages, stories and the word-data
 * cache — so a restore brings back the article list, illustrations, wordbook glosses and progress, not
 * only scheduling. Illustration bytes live in the `images` table (F-5 第3段) and are carried through
 * the JSON as base64 `data:` URLs (`includeImages`, default true — set false for a small text-only
 * backup that also null-outs the passage/story image references). Audio/timing maps stay out of scope
 * (regenerable). Import accepts a v1 payload too (assets/images simply absent).
 */

import { APP_SCHEMA_VERSION, type LexiaDb, type StoredSettings, type WordCacheRecord } from '../persistence/lexiaDb';
import type { PassageRecord, SyncAdapter, SyncExportOptions } from '../../types/ports';
import { blobToDataUrl, dataUrlToBlob } from '../persistence/imageStore';
import type {
  UserId,
  WordSchedulingState,
  ReviewLogEntry,
  ReadingProgress,
  StoryRecord,
} from '../../types/domain';

export const SYNC_FORMAT_VERSION = 2;

/** Image field paths null-outed on a text-only (`includeImages:false`) export. */
const STORY_IMAGE_FIELDS = ['illustrationUrl', 'portraitIllustrationUrl', 'fullBodyIllustrationUrl'] as const;

/** One illustration carried through the backup JSON (Blob re-encoded as a base64 data URL). */
export interface SerializedImage {
  imageId: string;
  userId: string;
  mime: string;
  createdAt: number;
  dataUrl: string;
}

export interface SyncPayload {
  formatVersion: number;
  userId: string;
  scheduling: WordSchedulingState[];
  reviewLog: ReviewLogEntry[];
  progress: ReadingProgress[];
  settings: StoredSettings[];
  /** v2+ assets. Absent on a v1 backup. */
  passages?: PassageRecord[];
  stories?: StoryRecord[];
  wordCache?: WordCacheRecord[];
  /** v2+ illustration blobs (base64). Absent on a v1 backup or an `includeImages:false` export. */
  images?: SerializedImage[];
}

/** Deep-clone a passage record with its scene illustration + thumbnail references removed (text-only export). */
function stripPassageImage(record: PassageRecord): PassageRecord {
  if (!record.passage?.meta?.sceneIllustrationUrl && !record.passage?.meta?.sceneThumbnailUrl) return record;
  return {
    ...record,
    passage: {
      ...record.passage,
      meta: { ...record.passage.meta, sceneIllustrationUrl: undefined, sceneThumbnailUrl: undefined },
    },
  };
}

/** Deep-clone a story record with every character illustration reference removed (text-only export). */
function stripStoryImages(record: StoryRecord): StoryRecord {
  const characters = record.plan?.characters;
  if (!Array.isArray(characters)) return record;
  return {
    ...record,
    plan: {
      ...record.plan,
      characters: characters.map((character) => {
        const next = { ...character } as Record<string, unknown>;
        for (const field of STORY_IMAGE_FIELDS) if (field in next) next[field] = undefined;
        return next as unknown as (typeof characters)[number];
      }),
    },
  };
}

export class JsonSyncAdapter implements SyncAdapter {
  constructor(private readonly db: LexiaDb) {}

  async export(userId: UserId, options: SyncExportOptions = {}): Promise<Blob> {
    const includeImages = options.includeImages ?? true;
    const [scheduling, reviewLog, progress, settings, passages, stories, wordCache, images] = await Promise.all([
      this.db.scheduling.where('userId').equals(userId).toArray(),
      this.db.reviewLog.filter((e) => e.userId === userId).toArray(),
      this.db.progress.where('userId').equals(userId).toArray(),
      this.db.settings.get(userId),
      this.db.passages.where('userId').equals(userId).toArray(),
      this.db.stories.where('userId').equals(userId).toArray(),
      this.db.wordCache.where('userId').equals(userId).toArray(),
      includeImages ? this.db.images.where('userId').equals(userId).toArray() : Promise.resolve([]),
    ]);

    const serializedImages: SerializedImage[] = includeImages
      ? await Promise.all(
          images.map(async (img) => ({
            imageId: img.imageId,
            userId: String(img.userId),
            mime: img.mime,
            createdAt: img.createdAt,
            dataUrl: await blobToDataUrl(img.blob),
          })),
        )
      : [];

    const payload: SyncPayload = {
      formatVersion: SYNC_FORMAT_VERSION,
      userId: String(userId),
      scheduling,
      reviewLog,
      progress,
      settings: settings ? [settings] : [],
      passages: includeImages ? passages : passages.map(stripPassageImage),
      stories: includeImages ? stories : stories.map(stripStoryImages),
      wordCache,
      images: serializedImages,
    };
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  }

  // Written as an arrow class field rather than an `import(...)` method shorthand: some
  // web-mode bundler transforms misparse the bare `import(` as a dynamic import() call.
  // An `import = …` field keeps the SyncAdapter contract while sidestepping that.
  import = async (userId: UserId, blob: Blob): Promise<void> => {
    const payload = JSON.parse(await blob.text()) as SyncPayload;

    await this.db.transaction(
      'rw',
      [
        this.db.scheduling,
        this.db.reviewLog,
        this.db.progress,
        this.db.settings,
        this.db.passages,
        this.db.stories,
        this.db.wordCache,
        this.db.images,
      ],
      async () => {
        if (payload.scheduling.length) {
          await this.db.scheduling.bulkPut(payload.scheduling.map((s) => ({ ...s, userId })));
        }
        if (payload.reviewLog.length) {
          // Append-only: drop source ids so the target assigns fresh auto-increment keys.
          await this.db.reviewLog.bulkAdd(
            payload.reviewLog.map((e) => {
              const copy = { ...e, userId };
              delete copy.id;
              return copy;
            }),
          );
        }
        if (payload.progress.length) {
          // Legacy (pre-F-2) backups have no lastOpenedAt; seed it from startedAt so the row is valid.
          await this.db.progress.bulkPut(
            payload.progress.map((p) => ({ ...p, userId, lastOpenedAt: p.lastOpenedAt ?? p.startedAt })),
          );
        }
        if (payload.settings.length) {
          await this.db.settings.bulkPut(
            payload.settings.map((s) => ({ ...s, userId, appSchemaVersion: APP_SCHEMA_VERSION })),
          );
        }
        // v2 assets — absent on a v1 backup, so each guard no-ops. Records are re-stamped into the
        // target namespace; image references (`lexia-image:<id>`) resolve against the images restored
        // below (or fall back to any inline data URL an includeImages:false backup left null).
        if (payload.passages?.length) {
          await this.db.passages.bulkPut(payload.passages.map((p) => ({ ...p, userId })));
        }
        if (payload.stories?.length) {
          await this.db.stories.bulkPut(payload.stories.map((s) => ({ ...s, userId })));
        }
        if (payload.wordCache?.length) {
          await this.db.wordCache.bulkPut(payload.wordCache.map((w) => ({ ...w, userId })));
        }
        if (payload.images?.length) {
          await this.db.images.bulkPut(
            payload.images.map((img) => {
              const decoded = dataUrlToBlob(img.dataUrl);
              return {
                imageId: img.imageId,
                userId,
                mime: img.mime ?? decoded?.mime ?? 'application/octet-stream',
                blob: decoded?.blob ?? new Blob([], { type: img.mime }),
                createdAt: img.createdAt ?? Date.now(),
              };
            }),
          );
        }
      },
    );
  };
}

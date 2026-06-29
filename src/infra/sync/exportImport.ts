/**
 * L2 — JsonSyncAdapter: the SyncAdapter seam (design.md "SyncAdapter", 13.4). Exports
 * the learner's recoverable state — scheduling + reviewLog + progress + settings — as a
 * single JSON Blob, and imports it back, re-stamping the target namespace. This is the
 * local backup/restore shim; real cloud sync is future work. Audio/passage assets are
 * regenerable and intentionally out of scope here.
 */

import { APP_SCHEMA_VERSION, type LexiaDb, type StoredSettings } from '../persistence/lexiaDb';
import type { SyncAdapter } from '../../types/ports';
import type {
  UserId,
  WordSchedulingState,
  ReviewLogEntry,
  ReadingProgress,
} from '../../types/domain';

export const SYNC_FORMAT_VERSION = 1;

export interface SyncPayload {
  formatVersion: number;
  userId: string;
  scheduling: WordSchedulingState[];
  reviewLog: ReviewLogEntry[];
  progress: ReadingProgress[];
  settings: StoredSettings[];
}

export class JsonSyncAdapter implements SyncAdapter {
  constructor(private readonly db: LexiaDb) {}

  async export(userId: UserId): Promise<Blob> {
    const [scheduling, reviewLog, progress, settings] = await Promise.all([
      this.db.scheduling.where('userId').equals(userId).toArray(),
      this.db.reviewLog.filter((e) => e.userId === userId).toArray(),
      this.db.progress.where('userId').equals(userId).toArray(),
      this.db.settings.get(userId),
    ]);
    const payload: SyncPayload = {
      formatVersion: SYNC_FORMAT_VERSION,
      userId: String(userId),
      scheduling,
      reviewLog,
      progress,
      settings: settings ? [settings] : [],
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
      [this.db.scheduling, this.db.reviewLog, this.db.progress, this.db.settings],
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
          await this.db.progress.bulkPut(payload.progress.map((p) => ({ ...p, userId })));
        }
        if (payload.settings.length) {
          await this.db.settings.bulkPut(
            payload.settings.map((s) => ({ ...s, userId, appSchemaVersion: APP_SCHEMA_VERSION })),
          );
        }
      },
    );
  };
}

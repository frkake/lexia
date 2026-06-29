/**
 * L2 — AuthAdapter: wraps the adjacent auth capability to supply the learner `userId`
 * and, on the first anonymous → signed-in transition, migrates the learning data from
 * the `anonymous` namespace DB into `lexia_<userId>` (design.md "AuthProvider", 13.4).
 * Before sign-in the adapter returns the `anonymous` id so the app is fully usable;
 * the one-time migration preserves everything accumulated while anonymous.
 */

import { openLexiaDb, type LexiaDb } from '../persistence/lexiaDb';
import type { AuthProvider } from '../../types/ports';
import type { UserId } from '../../types/domain';

/** The pre-sign-in namespace id. */
export const ANONYMOUS_USER_ID = 'anonymous' as UserId;

/** Minimal view of the adjacent auth capability this adapter needs. */
export interface AdjacentAuth {
  /** The current signed-in id, or null while anonymous. */
  currentUserId(): string | null;
  /** Subscribe to id changes; returns an unsubscribe. */
  subscribe(cb: (userId: string | null) => void): () => void;
}

type OpenDb = (userId: string) => Promise<LexiaDb>;
type Migrate = (toUserId: UserId, openDb: OpenDb) => Promise<void>;

export interface AuthAdapterOptions {
  /** Injectable DB opener (defaults to openLexiaDb). */
  openDb?: OpenDb;
  /** Injectable migration (defaults to migrateAnonymousNamespace) for testing. */
  migrate?: Migrate;
}

/** Copy every learner store from `source` to `target`, re-stamping the userId. */
async function migrateLearnerData(source: LexiaDb, target: LexiaDb, toUserId: UserId): Promise<void> {
  const [scheduling, reviewLog, passages, timingMaps, progress, settings, wordCache] = await Promise.all([
    source.scheduling.toArray(),
    source.reviewLog.toArray(),
    source.passages.toArray(),
    source.timingMaps.toArray(),
    source.progress.toArray(),
    source.settings.toArray(),
    source.wordCache.toArray(),
  ]);

  await target.transaction(
    'rw',
    [
      target.scheduling,
      target.reviewLog,
      target.passages,
      target.timingMaps,
      target.progress,
      target.settings,
      target.wordCache,
    ],
    async () => {
      if (scheduling.length) await target.scheduling.bulkPut(scheduling.map((s) => ({ ...s, userId: toUserId })));
      if (reviewLog.length) {
        // Append-only: drop the source auto-increment id so target assigns fresh ones.
        await target.reviewLog.bulkAdd(
          reviewLog.map((e) => {
            const copy = { ...e, userId: toUserId };
            delete copy.id;
            return copy;
          }),
        );
      }
      if (passages.length) await target.passages.bulkPut(passages.map((p) => ({ ...p, userId: toUserId })));
      if (timingMaps.length) await target.timingMaps.bulkPut(timingMaps); // no userId field
      if (progress.length) await target.progress.bulkPut(progress.map((p) => ({ ...p, userId: toUserId })));
      if (settings.length) await target.settings.bulkPut(settings.map((s) => ({ ...s, userId: toUserId })));
      if (wordCache.length) await target.wordCache.bulkPut(wordCache.map((w) => ({ ...w, userId: toUserId })));
    },
  );
}

/** Migrate the anonymous namespace into the signed-in learner's namespace (one-shot). */
export async function migrateAnonymousNamespace(
  toUserId: UserId,
  openDb: OpenDb = openLexiaDb,
): Promise<void> {
  if (toUserId === ANONYMOUS_USER_ID) return;
  const source = await openDb(ANONYMOUS_USER_ID);
  const target = await openDb(String(toUserId));
  try {
    await migrateLearnerData(source, target, toUserId);
  } finally {
    source.close();
    target.close();
  }
}

export class AuthAdapter implements AuthProvider {
  private migrated = false;

  constructor(
    private readonly adjacent: AdjacentAuth,
    private readonly options: AuthAdapterOptions = {},
  ) {}

  async getUserId(): Promise<UserId> {
    return (this.adjacent.currentUserId() ?? ANONYMOUS_USER_ID) as UserId;
  }

  isAnonymous(): boolean {
    return this.adjacent.currentUserId() === null;
  }

  onUserChange(cb: (userId: UserId) => void): () => void {
    return this.adjacent.subscribe((raw) => {
      void this.handleChange(raw, cb);
    });
  }

  private async handleChange(raw: string | null, cb: (userId: UserId) => void): Promise<void> {
    if (raw !== null && !this.migrated) {
      this.migrated = true;
      const migrate = this.options.migrate ?? migrateAnonymousNamespace;
      await migrate(raw as UserId, this.options.openDb ?? openLexiaDb);
    }
    cb((raw ?? ANONYMOUS_USER_ID) as UserId);
  }
}

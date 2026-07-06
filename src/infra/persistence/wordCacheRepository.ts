import type { CachedWordData, WordCacheMeta, WordCacheRepository } from '../../types/ports';
import type { UserId, WordData } from '../../types/domain';
import type { LexiaDb, WordCacheRecord } from './lexiaDb';

/** Optional WordData cache (complements TanStack Query; URL refs only, no blobs). */
export class DexieWordCacheRepository implements WordCacheRepository {
  constructor(private readonly db: LexiaDb) {}

  get(userId: UserId, wordId: string): Promise<CachedWordData | undefined> {
    return this.db.wordCache.get([userId, wordId]);
  }

  async put(userId: UserId, data: WordData, meta?: WordCacheMeta): Promise<void> {
    // `put` replaces the whole row by key, so omitting a metadata field clears any previous value
    // (e.g. an `enrichmentPending: true` flag is dropped once the data meets the contract).
    const record: WordCacheRecord = { ...data, userId };
    if (meta?.schemaVersion !== undefined) record.schemaVersion = meta.schemaVersion;
    if (meta?.enrichmentPending !== undefined) record.enrichmentPending = meta.enrichmentPending;
    await this.db.wordCache.put(record);
  }

  all(userId: UserId): Promise<WordData[]> {
    return this.db.wordCache.where('userId').equals(userId).toArray();
  }
}

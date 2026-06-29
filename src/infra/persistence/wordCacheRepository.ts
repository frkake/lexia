import type { WordCacheRepository } from '../../types/ports';
import type { UserId, WordData } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Optional WordData cache (complements TanStack Query; URL refs only, no blobs). */
export class DexieWordCacheRepository implements WordCacheRepository {
  constructor(private readonly db: LexiaDb) {}

  get(userId: UserId, wordId: string): Promise<WordData | undefined> {
    return this.db.wordCache.get([userId, wordId]);
  }

  async put(userId: UserId, data: WordData): Promise<void> {
    await this.db.wordCache.put({ ...data, userId });
  }

  all(userId: UserId): Promise<WordData[]> {
    return this.db.wordCache.where('userId').equals(userId).toArray();
  }
}

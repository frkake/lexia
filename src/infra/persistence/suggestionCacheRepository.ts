import type { CachedSuggestion, SuggestionCacheRepository } from '../../types/ports';
import type { UserId } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/**
 * L2 — cache-first store for suggestion-LLM proposal pools (E-3(c)). One row per learner × suggestion
 * key (`${level}|${intent}`); the SRS merge stays live in WordSuggestionService, so only the LLM
 * proposal list and its fetch time are persisted here.
 */
export class DexieSuggestionCacheRepository implements SuggestionCacheRepository {
  constructor(private readonly db: LexiaDb) {}

  async get(userId: UserId, suggestionKey: string): Promise<CachedSuggestion | undefined> {
    const row = await this.db.suggestionCache.get([userId, suggestionKey]);
    return row ? { proposals: row.proposals, updatedAt: row.updatedAt } : undefined;
  }

  async put(userId: UserId, suggestionKey: string, entry: CachedSuggestion): Promise<void> {
    await this.db.suggestionCache.put({
      userId,
      suggestionKey,
      proposals: entry.proposals,
      updatedAt: entry.updatedAt,
    });
  }
}

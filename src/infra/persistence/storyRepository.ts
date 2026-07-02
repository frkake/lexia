import type { StoryRepository } from '../../types/ports';
import type { StoryRecord, UserId } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Confirmed story plans (`stories` store, added in schema v2). */
export class DexieStoryRepository implements StoryRepository {
  constructor(private readonly db: LexiaDb) {}

  get(storyId: string): Promise<StoryRecord | undefined> {
    return this.db.stories.get(storyId);
  }

  async put(record: StoryRecord): Promise<void> {
    await this.db.stories.put(record);
  }

  /** Most-recently created first (uses the `createdAt` index). */
  recent(userId: UserId, limit: number): Promise<StoryRecord[]> {
    return this.db.stories
      .orderBy('createdAt')
      .reverse()
      .filter((s) => s.userId === userId)
      .limit(limit)
      .toArray();
  }
}

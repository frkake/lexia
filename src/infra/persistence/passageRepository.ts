import type { PassageRepository, PassageRecord } from '../../types/ports';
import type { UserId } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Normalized passage store (PassageOutput is re-indexed deterministically on load). */
export class DexiePassageRepository implements PassageRepository {
  constructor(private readonly db: LexiaDb) {}

  get(passageId: string): Promise<PassageRecord | undefined> {
    return this.db.passages.get(passageId);
  }

  async put(record: PassageRecord): Promise<void> {
    await this.db.passages.put(record);
  }

  /** Most-recently created first (uses the `createdAt` index). */
  recent(userId: UserId, limit: number): Promise<PassageRecord[]> {
    return this.db.passages
      .orderBy('createdAt')
      .reverse()
      .filter((p) => p.userId === userId)
      .limit(limit)
      .toArray();
  }

  async byStory(userId: UserId, storyId: string): Promise<PassageRecord[]> {
    const rows = await this.db.passages.where('passage.meta.storyRef.storyId').equals(storyId).toArray();
    return rows
      .filter((p) => p.userId === userId)
      .sort((a, b) => (a.passage.meta.storyRef?.chapterIndex ?? 0) - (b.passage.meta.storyRef?.chapterIndex ?? 0));
  }
}

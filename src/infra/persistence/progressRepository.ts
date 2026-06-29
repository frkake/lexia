import type { ProgressRepository } from '../../types/ports';
import type { UserId, ReadingProgress } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Reading-progress store (resume + dashboard "reading now"). */
export class DexieProgressRepository implements ProgressRepository {
  constructor(private readonly db: LexiaDb) {}

  get(userId: UserId, passageId: string): Promise<ReadingProgress | undefined> {
    return this.db.progress.get([userId, passageId]);
  }

  async upsert(progress: ReadingProgress): Promise<void> {
    await this.db.progress.put(progress);
  }

  /** Entries with the given status, most-recently-started first. */
  async byStatus(
    userId: UserId,
    status: ReadingProgress['status'],
  ): Promise<ReadingProgress[]> {
    const rows = await this.db.progress
      .where('status')
      .equals(status)
      .filter((p) => p.userId === userId)
      .toArray();
    rows.sort((a, b) => b.startedAt - a.startedAt);
    return rows;
  }
}

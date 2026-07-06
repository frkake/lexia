import type { ReviewLogRepository } from '../../types/ports';
import type { UserId, ReviewLogEntry } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Append-only review log (FSRS replay, loss recovery, double-count cooldown). */
export class DexieReviewLogRepository implements ReviewLogRepository {
  constructor(private readonly db: LexiaDb) {}

  /** Append only — never update or delete (auto-incremented key). */
  async append(entry: ReviewLogEntry): Promise<void> {
    await this.db.reviewLog.add(entry);
  }

  /** All entries at/after `from`, ascending by time. */
  since(userId: UserId, from: number): Promise<ReviewLogEntry[]> {
    return this.db.reviewLog
      .where('at')
      .aboveOrEqual(from)
      .filter((e) => e.userId === userId)
      .toArray();
  }

  /**
   * Latest timestamp of ANY entry for a word — review, passage or undo (C-5d). Drives the
   * cross-source daily cooldown so a same-day explicit rating isn't overwritten by a read-through.
   */
  async lastUpdate(userId: UserId, wordId: string): Promise<number | undefined> {
    const entries = await this.db.reviewLog
      .where('[userId+wordId]')
      .equals([userId, wordId])
      .toArray();
    if (entries.length === 0) return undefined;
    return entries.reduce((max, e) => (e.at > max ? e.at : max), entries[0]!.at);
  }
}

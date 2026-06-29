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

  /** Latest passage-origin timestamp for a word (drives the daily cooldown). */
  async lastPassageUpdate(userId: UserId, wordId: string): Promise<number | undefined> {
    const entries = await this.db.reviewLog
      .where('[userId+wordId]')
      .equals([userId, wordId])
      .filter((e) => e.source === 'passage')
      .toArray();
    if (entries.length === 0) return undefined;
    return entries.reduce((max, e) => (e.at > max ? e.at : max), entries[0]!.at);
  }
}

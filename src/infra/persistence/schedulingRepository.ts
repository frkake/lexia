import type { SchedulingRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Dexie-backed scheduling store (system-of-record for FSRS state). */
export class DexieSchedulingRepository implements SchedulingRepository {
  constructor(private readonly db: LexiaDb) {}

  get(userId: UserId, wordId: string): Promise<WordSchedulingState | undefined> {
    return this.db.scheduling.get([userId, wordId]);
  }

  async upsert(state: WordSchedulingState): Promise<void> {
    await this.db.scheduling.put(state);
  }

  /** Due at/before `at`, due-soonest first (uses the `dueAt` index). */
  dueBefore(userId: UserId, at: number): Promise<WordSchedulingState[]> {
    return this.db.scheduling
      .where('dueAt')
      .belowOrEqual(at)
      .filter((s) => s.userId === userId)
      .toArray();
  }

  /** Lowest-stability first, limited (New words have no stability and are skipped). */
  lowStability(userId: UserId, limit: number): Promise<WordSchedulingState[]> {
    return this.db.scheduling
      .orderBy('stability')
      .filter((s) => s.userId === userId)
      .limit(limit)
      .toArray();
  }

  /** Count this learner's rows seeded at/after `from` (seededAt is non-indexed → scan by userId). */
  countSeededSince(userId: UserId, from: number): Promise<number> {
    return this.db.scheduling
      .where('userId')
      .equals(userId)
      .filter((s) => s.seededAt !== undefined && s.seededAt >= from)
      .count();
  }
}

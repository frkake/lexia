import type { TimingMapRepository } from '../../types/ports';
import type { TimingMap } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

/** Timing maps keyed by (passageId, voiceId); re-synthesis overwrites idempotently. */
export class DexieTimingMapRepository implements TimingMapRepository {
  constructor(private readonly db: LexiaDb) {}

  get(passageId: string, voiceId: string): Promise<TimingMap | undefined> {
    return this.db.timingMaps.get([passageId, voiceId]);
  }

  async put(timing: TimingMap): Promise<void> {
    await this.db.timingMaps.put(timing);
  }
}

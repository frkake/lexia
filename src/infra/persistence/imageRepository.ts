/**
 * L2 — DexieImageRepository: Blob-backed illustration store (F-5 第3段 / design decision D7).
 * One row per stored image, referenced from passage/story records by `lexia-image:<imageId>`.
 */

import type { ImageRecord, ImageRepository } from '../../types/ports';
import type { UserId } from '../../types/domain';
import type { LexiaDb } from './lexiaDb';

export class DexieImageRepository implements ImageRepository {
  constructor(private readonly db: LexiaDb) {}

  get(imageId: string): Promise<ImageRecord | undefined> {
    return this.db.images.get(imageId);
  }

  async put(record: ImageRecord): Promise<void> {
    await this.db.images.put(record);
  }

  all(userId: UserId): Promise<ImageRecord[]> {
    return this.db.images.where('userId').equals(userId).toArray();
  }

  async delete(imageId: string): Promise<void> {
    await this.db.images.delete(imageId);
  }
}

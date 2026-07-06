import { describe, it, expect } from 'vitest';
import {
  IMAGE_REF_SCHEME,
  blobToDataUrl,
  dataUrlToBlob,
  imageIdFromRef,
  imageRef,
  isImageRef,
  persistImage,
} from './imageStore';
import type { ImageRecord, ImageRepository } from '../../types/ports';
import type { UserId } from '../../types/domain';

class FakeImageRepo implements ImageRepository {
  rows = new Map<string, ImageRecord>();
  async get(imageId: string) {
    return this.rows.get(imageId);
  }
  async put(record: ImageRecord) {
    this.rows.set(record.imageId, record);
  }
  async all(userId: UserId) {
    return [...this.rows.values()].filter((r) => r.userId === userId);
  }
  async delete(imageId: string) {
    this.rows.delete(imageId);
  }
}

describe('image reference helpers', () => {
  it('builds and recognises lexia-image references', () => {
    expect(imageRef('abc')).toBe(`${IMAGE_REF_SCHEME}abc`);
    expect(isImageRef('lexia-image:abc')).toBe(true);
    expect(isImageRef('data:image/png;base64,AAAA')).toBe(false);
    expect(isImageRef('https://x/y.png')).toBe(false);
    expect(isImageRef(undefined)).toBe(false);
    expect(imageIdFromRef('lexia-image:abc')).toBe('abc');
    expect(imageIdFromRef('data:image/png;base64,AAAA')).toBeUndefined();
  });
});

describe('data URL ⇄ Blob', () => {
  it('decodes a base64 data URL to a typed Blob and back', async () => {
    const decoded = dataUrlToBlob('data:image/png;base64,AAAA');
    expect(decoded).not.toBeNull();
    expect(decoded!.mime).toBe('image/png');
    expect(new Uint8Array(await decoded!.blob.arrayBuffer())).toEqual(new Uint8Array([0, 0, 0]));
    // Round-trip preserves bytes + mime.
    const back = await blobToDataUrl(decoded!.blob);
    expect(back).toBe('data:image/png;base64,AAAA');
  });

  it('returns null for non-data-URL inputs (refs / http / undefined)', () => {
    expect(dataUrlToBlob('lexia-image:abc')).toBeNull();
    expect(dataUrlToBlob('https://x/y.png')).toBeNull();
    expect(dataUrlToBlob(undefined)).toBeNull();
  });

  it('round-trips arbitrary bytes through blobToDataUrl → dataUrlToBlob', async () => {
    const bytes = new Uint8Array([255, 216, 0, 1, 254, 128, 42]);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const decoded = dataUrlToBlob(dataUrl);
    expect(new Uint8Array(await decoded!.blob.arrayBuffer())).toEqual(bytes);
  });
});

describe('persistImage', () => {
  const U = 'u1' as UserId;

  it('stores a data URL as a blob and returns its ref', async () => {
    const repo = new FakeImageRepo();
    const ref = await persistImage(repo, U, 'data:image/png;base64,AAAA', 1000);
    expect(ref).toMatch(/^lexia-image:/);
    const stored = await repo.get(imageIdFromRef(ref)!);
    expect(stored?.mime).toBe('image/png');
    expect(stored?.userId).toBe(U);
    expect(stored?.createdAt).toBe(1000);
  });

  it('passes through refs, http URLs and empty values without writing', async () => {
    const repo = new FakeImageRepo();
    expect(await persistImage(repo, U, 'lexia-image:x', 1)).toBe('lexia-image:x');
    expect(await persistImage(repo, U, 'https://x/y.png', 1)).toBe('https://x/y.png');
    expect(await persistImage(repo, U, undefined, 1)).toBeUndefined();
    expect(repo.rows.size).toBe(0);
  });
});

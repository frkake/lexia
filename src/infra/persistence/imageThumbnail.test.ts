// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { coverCrop, downscaleBlobToThumbnail, THUMB_WIDTH, THUMB_HEIGHT } from './imageThumbnail';

describe('coverCrop (object-fit:cover source rectangle)', () => {
  it('crops the sides of a source wider than the target, centered', () => {
    // 400×100 into a 192×128 (aspect 1.5) box → keep full height, crop width to 100*1.5 = 150.
    const crop = coverCrop(400, 100, THUMB_WIDTH, THUMB_HEIGHT);
    expect(crop.sh).toBe(100);
    expect(crop.sw).toBeCloseTo(150, 5);
    expect(crop.sx).toBeCloseTo(125, 5); // (400 - 150) / 2
    expect(crop.sy).toBe(0);
  });

  it('crops the top/bottom of a source taller than the target, centered', () => {
    // 100×400 into a 1.5 box → keep full width, crop height to 100/1.5 ≈ 66.67.
    const crop = coverCrop(100, 400, THUMB_WIDTH, THUMB_HEIGHT);
    expect(crop.sw).toBe(100);
    expect(crop.sh).toBeCloseTo(66.6667, 3);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBeCloseTo((400 - 100 / 1.5) / 2, 3);
  });

  it('takes the whole image when the aspect ratios already match', () => {
    const crop = coverCrop(384, 256, THUMB_WIDTH, THUMB_HEIGHT); // both 1.5
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 384, sh: 256 });
  });

  it('degrades to the whole source for non-positive dimensions instead of dividing by zero', () => {
    expect(coverCrop(0, 100, THUMB_WIDTH, THUMB_HEIGHT)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 100 });
    expect(coverCrop(100, 100, 0, 128)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });
});

describe('downscaleBlobToThumbnail', () => {
  it('returns null (never throws) when no canvas/decoder is available', async () => {
    // node env: no createImageBitmap / canvas → graceful null so the caller keeps the full image.
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'image/png' });
    await expect(downscaleBlobToThumbnail(blob)).resolves.toBeNull();
  });
});

/**
 * L2 — scene-illustration thumbnailing (D-4 第2段).
 *
 * The 文章一覧 shows a small illustration per row. Decoding a full-size illustration (hundreds of KB)
 * per row is expensive, so each passage keeps a downscaled 192×128 thumbnail (`meta.sceneThumbnailUrl`,
 * a `lexia-image:` ref / D7). This module owns the canvas downscale: a pure `coverCrop` (the
 * object-fit:cover source-rectangle math, fully testable off the DOM) plus `downscaleBlobToThumbnail`,
 * the browser-only step that draws onto a canvas and re-encodes a JPEG blob.
 *
 * `downscaleBlobToThumbnail` degrades to `null` whenever the canvas/decode APIs are unavailable (jsdom,
 * older/locked-down browsers) or the source fails to decode — callers then simply keep showing the
 * full-size illustration. No throwing: a missing thumbnail is never an error.
 */

/** Thumbnail target box — 2× the 96×64 rendered slot for crisp display on retina screens. */
export const THUMB_WIDTH = 192;
export const THUMB_HEIGHT = 128;
/** JPEG keeps the thumbnail bytes small; photographic scene art has no transparency to preserve. */
export const THUMB_MIME = 'image/jpeg';
export const THUMB_QUALITY = 0.82;

export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * object-fit:cover source rectangle: the largest centered crop of a `srcW×srcH` image whose aspect
 * ratio matches `dstW×dstH`, so scaling it into the destination box fills it without distortion.
 * Pure — no canvas — so the cropping math is unit-tested directly.
 */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): CoverCrop {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // Source is wider than target → crop the sides.
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  // Source is taller (or equal) → crop top/bottom.
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/** Decode a Blob into something drawable, preferring `createImageBitmap` and falling back to `<img>`. */
async function decodeImage(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('no image decoder');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Allocate a drawing canvas, preferring `OffscreenCanvas` and falling back to a DOM `<canvas>`. */
function makeCanvas(width: number, height: number): {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob: (mime: string, quality: number) => Promise<Blob | null>;
} | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { ctx, toBlob: (mime, quality) => canvas.convertToBlob({ type: mime, quality }) };
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toBlob !== 'function') return null;
  return {
    ctx,
    toBlob: (mime, quality) =>
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality)),
  };
}

/**
 * Downscale an illustration blob into a `THUMB_WIDTH×THUMB_HEIGHT` cover-cropped JPEG blob. Returns
 * `null` (never throws) when no canvas/decoder is available or the source can't be decoded, so the
 * caller keeps the full-size illustration.
 */
export async function downscaleBlobToThumbnail(
  blob: Blob,
  width = THUMB_WIDTH,
  height = THUMB_HEIGHT,
): Promise<Blob | null> {
  let decoded: Awaited<ReturnType<typeof decodeImage>> | undefined;
  try {
    decoded = await decodeImage(blob);
    const canvas = makeCanvas(width, height);
    if (!canvas) return null;
    const crop = coverCrop(decoded.width, decoded.height, width, height);
    canvas.ctx.drawImage(decoded.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    return await canvas.toBlob(THUMB_MIME, THUMB_QUALITY);
  } catch {
    return null;
  } finally {
    decoded?.release();
  }
}

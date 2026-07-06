/**
 * L2 — image asset store helpers (F-5 第3段 / design decision D7).
 *
 * Illustration bytes used to be stored inline as base64 `data:` URLs on the passage/story records,
 * which bloats every record and every backup export. They now live as Blobs in the dedicated
 * `images` table, and the records carry a lightweight reference key instead — `lexia-image:<imageId>`.
 *
 * These are the pure, layer-free helpers shared by the Dexie migration (lexiaDb), the sync
 * export/import adapter, the image repository, and the display-side resolver (`AssetImage`). Anything
 * that is NOT a `lexia-image:` ref (a legacy inline `data:` URL, an `http(s):` URL, an object URL) is
 * treated as an already-displayable source and passes through untouched, so old records keep working.
 */

import type { UserId } from '../../types/domain';
import type { ImageRecord, ImageRepository } from '../../types/ports';

/** Reference scheme stored on a record in place of an inline image. */
export const IMAGE_REF_SCHEME = 'lexia-image:';

/** Build a reference key for a stored image id. */
export function imageRef(imageId: string): string {
  return `${IMAGE_REF_SCHEME}${imageId}`;
}

/** True when a stored image field is a `lexia-image:` reference (vs. a legacy data/http URL). */
export function isImageRef(src: string | null | undefined): src is string {
  return typeof src === 'string' && src.startsWith(IMAGE_REF_SCHEME);
}

/** Extract the image id from a `lexia-image:` reference, or undefined when it is not one. */
export function imageIdFromRef(src: string | null | undefined): string | undefined {
  return isImageRef(src) ? src.slice(IMAGE_REF_SCHEME.length) : undefined;
}

/**
 * Decode a base64 (or plain) `data:` URL into a Blob synchronously (no fetch — usable inside a Dexie
 * upgrade transaction). Returns null when the string is not a data URL (e.g. it is already a ref, an
 * http URL, or malformed) so callers can leave such values in place.
 */
export function dataUrlToBlob(src: string | null | undefined): { blob: Blob; mime: string } | null {
  if (typeof src !== 'string' || !src.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const header = src.slice(5, comma); // between "data:" and ","
  const body = src.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = (isBase64 ? header.slice(0, -';base64'.length) : header).split(';')[0] || 'application/octet-stream';
  try {
    if (isBase64) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { blob: new Blob([bytes], { type: mime }), mime };
    }
    return { blob: new Blob([decodeURIComponent(body)], { type: mime }), mime };
  } catch {
    return null;
  }
}

/** Encode a Blob back into a base64 `data:` URL (async — used to carry blobs through JSON backups). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000; // avoid arg-length limits on fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

let persistCounter = 0;

/**
 * Persist an inline image (a `data:` URL) into the `images` table and return its `lexia-image:` ref.
 * A value that is not a data URL (already a ref, an external http URL, empty) is returned unchanged so
 * callers can pipe every stored image field through this without special-casing. Intended as the
 * single write-side seam future illustration writers (E-3(d)(e)) route through.
 */
export async function persistImage(
  repo: ImageRepository,
  userId: UserId,
  src: string | null | undefined,
  now: number,
): Promise<string | undefined> {
  if (!src) return src ?? undefined;
  if (!src.startsWith('data:')) return src; // already a ref / external URL — leave as-is
  const decoded = dataUrlToBlob(src);
  if (!decoded) return src;
  const imageId = `img_${now}_${(persistCounter += 1)}_${Math.random().toString(36).slice(2, 8)}`;
  const record: ImageRecord = { imageId, userId, blob: decoded.blob, mime: decoded.mime, createdAt: now };
  await repo.put(record);
  return imageRef(imageId);
}

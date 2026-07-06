/**
 * L3 — thumbnailController: lazily derive a passage's scene thumbnail (D-4 第2段).
 *
 * The 文章一覧 prefers `meta.sceneThumbnailUrl` (a tiny 192×128 image) over the full-size
 * `sceneIllustrationUrl`. This controller fills that field on demand: given a passageId, it resolves
 * the illustration bytes (from the `images` table when the field is a `lexia-image:` ref, or by
 * decoding a legacy inline `data:` URL), downscales them via the injected `downscale` (the canvas step
 * lives in `imageThumbnail` so this stays testable off the DOM), stores the thumbnail as its own blob
 * in the `images` table (D7), and writes the reference back onto the passage.
 *
 * It is the single write-side seam for thumbnails — covering both freshly generated passages and
 * pre-existing ones — invoked the first time the library renders each passage. Idempotent (a stored
 * thumbnail short-circuits it), concurrency-safe (re-reads before writing so a racing thumbnail write
 * is never clobbered), and non-throwing (a failure just leaves the row on its full-size illustration).
 */

import { dataUrlToBlob, imageIdFromRef, imageRef } from '../../infra/persistence/imageStore';
import { THUMB_MIME } from '../../infra/persistence/imageThumbnail';
import type { PassageRecord, PassageRepository, ImageRepository, ImageRecord } from '../../types/ports';
import type { UserId } from '../../types/domain';

export interface ThumbnailControllerDeps {
  passages: PassageRepository;
  /** Blob store (D7): both the source illustration and the derived thumbnail live here. */
  images: ImageRepository;
  userId: UserId;
  now: () => number;
  /** Canvas downscale (injected so the DOM step is faked in tests). `null` ⇒ thumbnail unavailable. */
  downscale: (blob: Blob) => Promise<Blob | null>;
}

/** A passage wants a thumbnail when it has an illustration but no thumbnail derived from it yet. */
export function passageNeedsThumbnail(record: PassageRecord): boolean {
  const meta = record.passage.meta;
  return Boolean(meta.sceneIllustrationUrl) && !meta.sceneThumbnailUrl;
}

/** Resolve the illustration source (a ref into the images table, or an inline data URL) to a Blob. */
async function resolveIllustrationBlob(
  deps: ThumbnailControllerDeps,
  src: string,
): Promise<Blob | null> {
  const imageId = imageIdFromRef(src);
  if (imageId) {
    const record = await deps.images.get(imageId);
    return record?.blob ?? null;
  }
  const decoded = dataUrlToBlob(src); // legacy inline data URL (e.g. a freshly generated passage)
  return decoded?.blob ?? null;
}

/**
 * Derive and persist `meta.sceneThumbnailUrl` for one passage. Returns true only when a thumbnail was
 * newly stored; false for every no-op (already thumbnailed, no illustration, undecodable source, canvas
 * unavailable, missing record, or a race lost). Never throws.
 */
export async function ensurePassageThumbnail(
  deps: ThumbnailControllerDeps,
  passageId: string,
): Promise<boolean> {
  try {
    const record = await deps.passages.get(passageId);
    if (!record || record.userId !== deps.userId || !passageNeedsThumbnail(record)) return false;

    const source = await resolveIllustrationBlob(deps, record.passage.meta.sceneIllustrationUrl!);
    if (!source) return false;

    const thumbBlob = await deps.downscale(source);
    if (!thumbBlob) return false;

    // Re-read before writing so a concurrent thumbnail/illustration write is never clobbered.
    const fresh = await deps.passages.get(passageId);
    if (!fresh || fresh.userId !== deps.userId || fresh.passage.meta.sceneThumbnailUrl) return false;

    const now = deps.now();
    const imageId = `thumb_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const image: ImageRecord = {
      imageId,
      userId: deps.userId,
      blob: thumbBlob,
      mime: thumbBlob.type || THUMB_MIME,
      createdAt: now,
    };
    await deps.images.put(image);

    const enriched: PassageRecord = {
      ...fresh,
      passage: { ...fresh.passage, meta: { ...fresh.passage.meta, sceneThumbnailUrl: imageRef(imageId) } },
    };
    await deps.passages.put(enriched);
    return true;
  } catch {
    return false;
  }
}

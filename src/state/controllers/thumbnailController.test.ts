// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import {
  ensurePassageThumbnail,
  passageNeedsThumbnail,
  type ThumbnailControllerDeps,
} from './thumbnailController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { imageRef, imageIdFromRef, isImageRef } from '../../infra/persistence/imageStore';
import type { PassageOutput, UserId } from '../../types/domain';
import type { PassageRecord, ImageRecord } from '../../types/ports';

const PASSAGE_ID = 'p1';

function passageOutput(sceneUrl?: string, thumbUrl?: string): PassageOutput {
  return {
    meta: {
      title: 'T',
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 10,
      ...(sceneUrl ? { sceneIllustrationUrl: sceneUrl } : {}),
      ...(thumbUrl ? { sceneThumbnailUrl: thumbUrl } : {}),
    },
    sentences: [{ tokens: ['Hi', '.'], translationJa: 'やあ。' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

let seq = 0;
async function env() {
  const userId = `thumb_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  const repos = createRepositories(db);
  const jpeg = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
  const downscale = vi.fn(async () => jpeg());
  const deps: ThumbnailControllerDeps = {
    passages: repos.passages,
    images: repos.images,
    userId,
    now: () => 5000,
    downscale,
  };
  const putPassage = (rec: Partial<PassageRecord> & { passage: PassageOutput }) =>
    repos.passages.put({ passageId: PASSAGE_ID, userId, createdAt: 1000, ...rec });
  const putImage = async (imageId: string): Promise<string> => {
    const image: ImageRecord = { imageId, userId, blob: new Blob(['full'], { type: 'image/png' }), mime: 'image/png', createdAt: 100 };
    await repos.images.put(image);
    return imageRef(imageId);
  };
  return { userId, repos, deps, downscale, putPassage, putImage };
}

describe('passageNeedsThumbnail', () => {
  it('is true only with an illustration and no thumbnail yet', () => {
    const rec = (p: PassageOutput): PassageRecord => ({ passageId: 'x', userId: 'u' as UserId, createdAt: 0, passage: p });
    expect(passageNeedsThumbnail(rec(passageOutput()))).toBe(false); // no illustration
    expect(passageNeedsThumbnail(rec(passageOutput('lexia-image:a')))).toBe(true);
    expect(passageNeedsThumbnail(rec(passageOutput('lexia-image:a', 'lexia-image:t')))).toBe(false); // already thumbed
  });
});

describe('ensurePassageThumbnail', () => {
  it('downscales an images-table illustration and stores the thumbnail as its own ref', async () => {
    const { deps, repos, userId, downscale, putPassage, putImage } = await env();
    const sceneRef = await putImage('img_full_1');
    await putPassage({ passage: passageOutput(sceneRef) });

    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(true);
    expect(downscale).toHaveBeenCalledTimes(1);

    const stored = await repos.passages.get(PASSAGE_ID);
    const thumbUrl = stored!.passage.meta.sceneThumbnailUrl;
    expect(isImageRef(thumbUrl)).toBe(true);
    expect(thumbUrl).not.toBe(sceneRef); // a distinct thumbnail image, not the full one

    // The thumbnail blob lives in the images table and is a JPEG.
    const thumbImage = await repos.images.get(imageIdFromRef(thumbUrl)!);
    expect(thumbImage?.mime).toBe('image/jpeg');
    expect(await repos.images.all(userId)).toHaveLength(2); // full + thumbnail
  });

  it('decodes a legacy inline data-URL illustration into a thumbnail', async () => {
    const { deps, repos, putPassage } = await env();
    await putPassage({ passage: passageOutput('data:image/png;base64,AAAA') });

    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(true);
    const stored = await repos.passages.get(PASSAGE_ID);
    expect(isImageRef(stored!.passage.meta.sceneThumbnailUrl)).toBe(true);
  });

  it('is a no-op when the passage already has a thumbnail (idempotent across two calls)', async () => {
    const { deps, repos, userId, downscale, putPassage, putImage } = await env();
    const sceneRef = await putImage('img_full_1');
    await putPassage({ passage: passageOutput(sceneRef) });

    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(true);
    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(false); // second call sees the thumbnail
    expect(downscale).toHaveBeenCalledTimes(1);
    expect(await repos.images.all(userId)).toHaveLength(2); // full + one thumbnail, not two
  });

  it('is a no-op when the passage has no illustration', async () => {
    const { deps, repos, downscale, putPassage } = await env();
    await putPassage({ passage: passageOutput() });
    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(false);
    expect(downscale).not.toHaveBeenCalled();
    expect((await repos.passages.get(PASSAGE_ID))!.passage.meta.sceneThumbnailUrl).toBeUndefined();
  });

  it('leaves the illustration untouched when the canvas is unavailable (downscale → null)', async () => {
    const { deps, repos, putPassage, putImage } = await env();
    deps.downscale = vi.fn(async () => null);
    const sceneRef = await putImage('img_full_1');
    await putPassage({ passage: passageOutput(sceneRef) });

    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(false);
    expect((await repos.passages.get(PASSAGE_ID))!.passage.meta.sceneThumbnailUrl).toBeUndefined();
    expect(await repos.images.all(deps.userId)).toHaveLength(1); // only the full image, no thumbnail
  });

  it('is a no-op when the referenced illustration blob is missing', async () => {
    const { deps, downscale, putPassage } = await env();
    await putPassage({ passage: passageOutput(imageRef('img_missing')) });
    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(false);
    expect(downscale).not.toHaveBeenCalled();
  });

  it('never touches another learner’s passage', async () => {
    const { deps, repos, userId, putImage } = await env();
    const sceneRef = await putImage('img_full_1');
    await repos.passages.put({ passageId: PASSAGE_ID, userId: `${userId}_other` as UserId, createdAt: 1, passage: passageOutput(sceneRef) });
    expect(await ensurePassageThumbnail(deps, PASSAGE_ID)).toBe(false);
  });
});

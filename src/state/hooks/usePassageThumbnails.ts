/**
 * L3 — usePassageThumbnails (D-4 第2段, wiring layer). Lazily backfills each library row's scene
 * thumbnail the first time the 文章一覧 renders the passage.
 *
 * The library reads passages reactively (`useLiveQuery`), so when this hook stores a thumbnail the row
 * re-renders on the smaller image automatically. Work is deduped per session (a passage is attempted at
 * most once) and serialized through a single promise chain so we never run many canvas downscales at
 * once. Every step degrades silently — a passage that can't be thumbnailed simply keeps its full-size
 * illustration. Pure wiring: no React state, no DOM of its own.
 */

import { useEffect, useRef } from 'react';
import { ensurePassageThumbnail, passageNeedsThumbnail, type ThumbnailControllerDeps } from '../controllers/thumbnailController';
import type { PassageRecord } from '../../types/ports';

export function usePassageThumbnails(
  deps: ThumbnailControllerDeps | null,
  passages: PassageRecord[] | undefined,
): void {
  const attempted = useRef<Set<string>>(new Set());
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!deps || !passages) return;
    for (const record of passages) {
      if (attempted.current.has(record.passageId)) continue;
      if (!passageNeedsThumbnail(record)) continue;
      attempted.current.add(record.passageId);
      chain.current = chain.current.then(() => ensurePassageThumbnail(deps, record.passageId));
    }
  }, [deps, passages]);
}

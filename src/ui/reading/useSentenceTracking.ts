/**
 * L4 — useSentenceTracking (F-2). Observes the reading body with an IntersectionObserver and
 * reports the furthest sentence the learner has scrolled past, so the reading position advances
 * automatically without an explicit "ここまで読んだ" control. Each sentence element tags itself with
 * `data-sentence-index="<n>"` (grid rows and prose spans alike); the hook watches them inside the
 * measurement container and calls `onReach(maxIndex)` with the highest index that has become
 * visible. It only ever moves forward — scrolling back up does not rewind the reported position.
 *
 * Geometry-only and side-effect-free itself: the caller decides what to do with the reported index
 * (the reading route pipes it into `sessionStore.updateProgress`, which the persistence hook then
 * debounces to the ProgressRepository). Absent IntersectionObserver (SSR / old host) it is a no-op.
 */

import { useEffect, useRef } from 'react';

/** CSS attribute marking a sentence element with its zero-based sentence index. */
export const SENTENCE_INDEX_ATTR = 'data-sentence-index';

export interface UseSentenceTrackingDeps {
  /** The measurement container whose sentence elements are observed. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Active passage id; a change re-subscribes the observer to the new passage's sentences. */
  passageId: string;
  /** Sentence count; a change (annotation/illustration refresh re-renders) re-subscribes. */
  sentenceCount: number;
  /** False to disable tracking (e.g. no active passage). */
  enabled?: boolean;
  /** Called with the furthest (max) sentence index that has entered the viewport. */
  onReach: (sentenceIndex: number) => void;
  /** Visibility threshold for counting a sentence as "reached" (default 0.5). */
  threshold?: number;
  /** Bump to re-subscribe with a fresh watermark (e.g. after a "先頭から読む" reset). */
  resetKey?: number;
}

export function useSentenceTracking({
  containerRef,
  passageId,
  sentenceCount,
  enabled = true,
  onReach,
  threshold = 0.5,
  resetKey = 0,
}: UseSentenceTrackingDeps): void {
  // Keep the latest callback without re-subscribing the observer every render.
  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;

  useEffect(() => {
    if (!enabled) return;
    if (typeof IntersectionObserver !== 'function') return;
    const container = containerRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>(`[${SENTENCE_INDEX_ATTR}]`);
    if (nodes.length === 0) return;

    let maxReached = -1;
    const observer = new IntersectionObserver(
      (entries) => {
        let advanced = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).getAttribute(SENTENCE_INDEX_ATTR));
          if (!Number.isFinite(idx)) continue;
          if (idx > maxReached) {
            maxReached = idx;
            advanced = true;
          }
        }
        if (advanced && maxReached >= 0) onReachRef.current(maxReached);
      },
      { root: null, threshold },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [containerRef, passageId, sentenceCount, enabled, threshold, resetKey]);
}

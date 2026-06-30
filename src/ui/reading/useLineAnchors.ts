/**
 * L4 — useLineAnchors (design.md "useLineAnchors", Requirement 2.1–2.3). Measures the
 * container-relative Y position of every annotation badge in the reading body so the
 * NoticeRail can align each item to the line its expression appears on. Measurement is
 * geometry-only (no domain knowledge): each badge tags itself with `data-line-anchor="<cueIndex>"`
 * and the hook collects `getBoundingClientRect().top - container.top` per cue.
 *
 * Triggers a remeasure on font-scale change, passage change, and `ResizeObserver` firing
 * (reflow/wrap). All triggers coalesce into a SINGLE `requestAnimationFrame` so a burst of
 * resize events causes one measurement, not a reflow storm (Requirement 2.2 performance).
 * When `enabled` is false (narrow layout fallback) it measures nothing and returns no anchors.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** A measured badge: its cue index and the Y offset from the measurement container's top. */
export interface LineAnchor {
  cueIndex: number;
  /** Container-relative Y coordinate (px). */
  top: number;
}

export interface UseLineAnchorsResult {
  /** cueIndex → container-relative Y, sorted by cue index. Empty when disabled. */
  anchors: LineAnchor[];
  /** Attach to the element whose badges (data-line-anchor) should be measured. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseLineAnchorsDeps {
  /** Current reading font scale; a change reflows lines and forces a remeasure. */
  fontScale: number;
  /** Active passage id; a change resets and remeasures. */
  passageId: string;
  /** False in the narrow/mobile fallback: skip measurement and report no anchors. */
  enabled?: boolean;
}

/** CSS attribute marking a measurable badge with its cue index. */
export const LINE_ANCHOR_ATTR = 'data-line-anchor';

export function useLineAnchors({ fontScale, passageId, enabled = true }: UseLineAnchorsDeps): UseLineAnchorsResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<LineAnchor[]>([]);
  // A single pending rAF id so concurrent triggers coalesce into one measurement.
  const frameRef = useRef<number | null>(null);

  const measure = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const nodes = container.querySelectorAll<HTMLElement>(`[${LINE_ANCHOR_ATTR}]`);
    const next: LineAnchor[] = [];
    nodes.forEach((node) => {
      const raw = node.getAttribute(LINE_ANCHOR_ATTR);
      if (raw === null) return;
      const cueIndex = Number(raw);
      if (!Number.isFinite(cueIndex)) return;
      next.push({ cueIndex, top: node.getBoundingClientRect().top - containerTop });
    });
    next.sort((a, b) => a.cueIndex - b.cueIndex);
    setAnchors(next);
  }, []);

  /** Queue a measurement on the next frame; repeated calls in one frame collapse to one. */
  const scheduleMeasure = useCallback((): void => {
    if (frameRef.current !== null) return;
    // Without rAF (SSR / unusual host) fall back to a synchronous measure.
    if (typeof requestAnimationFrame !== 'function') {
      measure();
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    if (!enabled) {
      // Narrow fallback: drop any prior anchors and do not observe.
      setAnchors([]);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    scheduleMeasure(); // initial measurement after layout

    // ResizeObserver may be absent (older host / jsdom without a stub): the initial measure still
    // ran above; we just skip reflow-driven remeasures rather than throwing.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleMeasure()) : null;
    observer?.observe(container);

    return () => {
      observer?.disconnect();
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // fontScale + passageId are remeasure triggers: re-running the effect re-observes and remeasures.
  }, [enabled, fontScale, passageId, scheduleMeasure]);

  return { anchors, containerRef };
}

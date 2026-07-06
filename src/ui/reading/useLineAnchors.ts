/**
 * L4 — useLineAnchors (design.md "useLineAnchors", Requirement 2.1–2.3). Measures the
 * container-relative Y position of every annotation badge in the reading body so the
 * NoticeRail can align each item to the line its expression appears on. Measurement is
 * geometry-only (no domain knowledge): each badge/word tags itself with `data-line-anchor="<itemId>"`
 * and the hook collects `getBoundingClientRect().top - container.top` per cue.
 *
 * Triggers a remeasure on font-scale change, passage change, and `ResizeObserver` firing
 * (reflow/wrap). All triggers coalesce into a SINGLE `requestAnimationFrame` so a burst of
 * resize events causes one measurement, not a reflow storm (Requirement 2.2 performance).
 * When `enabled` is false (narrow layout fallback) it measures nothing and returns no anchors.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** A measured inline guide anchor and its Y offset from the measurement container's top. */
export interface LineAnchor {
  /** String id for the guide item (`word:...`, `notice:...`). */
  itemId?: string;
  /** Legacy numeric cue index, retained for the old NoticeRail tests/component. */
  cueIndex?: number;
  /** Container-relative Y coordinate (px). */
  top: number;
}

export interface UseLineAnchorsResult {
  /** itemId/cueIndex → FRAME-relative Y (frame = `.reading-layout` common ancestor). Empty when disabled. */
  anchors: LineAnchor[];
  /** Attach to the element whose badges (data-line-anchor) should be measured (the prose wrapper). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Attach to the common layout ancestor (`.reading-layout`) that also contains the rail. Anchor Y is
   * measured relative to THIS frame, so the rail can subtract its own frame-relative origin and place
   * each card on its badge's line even though the two live in different sub-trees (D-1 coordinate-system
   * unification). Falls back to the prose container when no frame is attached (legacy / unit harness).
   */
  frameRef: React.RefObject<HTMLDivElement | null>;
  /** Force a coalesced remeasure (e.g. after the scene illustration loads and shifts the prose down). */
  remeasure: () => void;
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
  const frameElRef = useRef<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<LineAnchor[]>([]);
  // A single pending rAF id so concurrent triggers coalesce into one measurement.
  const rafRef = useRef<number | null>(null);

  const measure = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    // Measure every badge Y against the common ancestor frame (`.reading-layout`) so the rail, which
    // sits in a different sub-tree with a large origin offset (toolbar/title/illustration stacked above
    // the prose), can subtract its own frame-relative origin and land each card on its badge's line.
    // Falls back to the prose container when no frame is attached (legacy callers / unit harness).
    const origin = frameElRef.current ?? container;
    const originTop = origin.getBoundingClientRect().top;
    const nodes = container.querySelectorAll<HTMLElement>(`[${LINE_ANCHOR_ATTR}]`);
    const next: LineAnchor[] = [];
    nodes.forEach((node) => {
      const raw = node.getAttribute(LINE_ANCHOR_ATTR);
      if (raw === null) return;
      const cueIndex = Number(raw);
      const top = node.getBoundingClientRect().top - originTop;
      if (Number.isFinite(cueIndex)) {
        next.push({ cueIndex, top });
      } else {
        next.push({ itemId: raw, top });
      }
    });
    next.sort((a, b) => (a.cueIndex ?? 0) - (b.cueIndex ?? 0) || (a.itemId ?? '').localeCompare(b.itemId ?? ''));
    setAnchors(next);
  }, []);

  /** Queue a measurement on the next frame; repeated calls in one frame collapse to one. */
  const scheduleMeasure = useCallback((): void => {
    if (rafRef.current !== null) return;
    // Without rAF (SSR / unusual host) fall back to a synchronous measure.
    if (typeof requestAnimationFrame !== 'function') {
      measure();
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
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
    // ran above; we just skip reflow-driven remeasures rather than throwing. Observe BOTH the prose
    // container (line wrap) and the frame (illustration load / title reflow shifts everything below it).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleMeasure()) : null;
    observer?.observe(container);
    if (frameElRef.current) observer?.observe(frameElRef.current);

    return () => {
      observer?.disconnect();
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // fontScale + passageId are remeasure triggers: re-running the effect re-observes and remeasures.
  }, [enabled, fontScale, passageId, scheduleMeasure]);

  return { anchors, containerRef, frameRef: frameElRef, remeasure: scheduleMeasure };
}

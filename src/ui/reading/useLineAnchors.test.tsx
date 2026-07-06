// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useLineAnchors } from './useLineAnchors';

/**
 * jsdom does no layout, so we drive measurement deterministically:
 *  - getBoundingClientRect reads each element's `data-top` (px), default 0;
 *  - requestAnimationFrame is queued and flushed manually so a measure is observable;
 *  - ResizeObserver is a stub whose instances we can fire.
 */
let rafQueue: FrameRequestCallback[] = [];
const observerInstances: ResizeStub[] = [];

class ResizeStub {
  constructor(readonly cb: ResizeObserverCallback) {
    observerInstances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.cb([], this as unknown as ResizeObserver);
  }
}

function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((cb) => cb(0));
}

beforeEach(() => {
  rafQueue = [];
  observerInstances.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', ResizeStub);
  // Each element's screen top comes from its data-top attribute.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const top = Number(this.getAttribute('data-top') ?? '0');
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} };
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

interface HarnessProps {
  fontScale: number;
  passageId: string;
  /** [cueIndex, screenTop] pairs for the anchored badges. */
  tops: [number, number][];
  enabled?: boolean;
}

function Harness({ fontScale, passageId, tops, enabled }: HarnessProps) {
  const { anchors, containerRef } = useLineAnchors({ fontScale, passageId, enabled });
  return (
    <div ref={containerRef} data-top="10">
      {tops.map(([idx, top]) => (
        <span key={idx} data-line-anchor={idx} data-top={top}>
          {idx}
        </span>
      ))}
      <output data-testid="anchors">{JSON.stringify(anchors)}</output>
    </div>
  );
}

function StringHarness() {
  const { anchors, containerRef } = useLineAnchors({ fontScale: 1, passageId: 'p1' });
  return (
    <div ref={containerRef} data-top="10">
      <span data-line-anchor="word:deal" data-top="40">deal</span>
      <span data-line-anchor="notice:2" data-top="90">notice</span>
      <output data-testid="anchors">{JSON.stringify(anchors)}</output>
    </div>
  );
}

/** Attaches the frame ref to an outer ancestor (top 5) with the prose container nested inside (top 10). */
function FrameHarness({ tops }: { tops: [number, number][] }) {
  const { anchors, containerRef, frameRef } = useLineAnchors({ fontScale: 1, passageId: 'p1' });
  return (
    <div ref={frameRef} data-top="5">
      <div ref={containerRef} data-top="10">
        {tops.map(([idx, top]) => (
          <span key={idx} data-line-anchor={idx} data-top={top}>
            {idx}
          </span>
        ))}
        <output data-testid="anchors">{JSON.stringify(anchors)}</output>
      </div>
    </div>
  );
}

function readAnchors(getByTestId: (id: string) => HTMLElement): { cueIndex: number; top: number }[] {
  return JSON.parse(getByTestId('anchors').textContent || '[]');
}

describe('useLineAnchors', () => {
  it('returns each badge cue index with its container-relative Y, sorted by cue index', () => {
    const { getByTestId } = render(
      // Provided out of order to prove sorting; container top is 10.
      <Harness fontScale={1} passageId="p1" tops={[[3, 120], [1, 40], [2, 80]]} />,
    );
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([
      { cueIndex: 1, top: 30 },
      { cueIndex: 2, top: 70 },
      { cueIndex: 3, top: 110 },
    ]);
  });

  it('also returns string guide item ids for study-word anchors', () => {
    const { getByTestId } = render(<StringHarness />);
    act(() => flushRaf());
    expect(JSON.parse(getByTestId('anchors').textContent || '[]')).toEqual([
      { itemId: 'notice:2', top: 80 },
      { itemId: 'word:deal', top: 30 },
    ]);
  });

  it('measures anchors relative to the frame ancestor when a frameRef is attached (D-1)', () => {
    // Frame top = 5, container top = 10; anchors must be measured against the FRAME (top - 5), not the
    // container, so the rail can subtract its own frame-relative origin and align to the badge line.
    const { getByTestId } = render(<FrameHarness tops={[[1, 40], [2, 80]]} />);
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([
      { cueIndex: 1, top: 35 },
      { cueIndex: 2, top: 75 },
    ]);
  });

  it('recomputes coordinates when the font scale changes', () => {
    const { getByTestId, rerender } = render(
      <Harness fontScale={1} passageId="p1" tops={[[1, 40], [2, 80]]} />,
    );
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([
      { cueIndex: 1, top: 30 },
      { cueIndex: 2, top: 70 },
    ]);
    // Larger font → lines reflow lower: same badges now sit further down.
    rerender(<Harness fontScale={1.3} passageId="p1" tops={[[1, 60], [2, 130]]} />);
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([
      { cueIndex: 1, top: 50 },
      { cueIndex: 2, top: 120 },
    ]);
  });

  it('re-measures when the container ResizeObserver fires', () => {
    const { getByTestId } = render(<Harness fontScale={1} passageId="p1" tops={[[1, 40]]} />);
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([{ cueIndex: 1, top: 30 }]);
    // Simulate a width change that moved the badge, then fire the observer.
    getByTestId('anchors').parentElement!.querySelector('[data-line-anchor="1"]')!.setAttribute('data-top', '90');
    act(() => {
      observerInstances.forEach((o) => o.fire());
      flushRaf();
    });
    expect(readAnchors(getByTestId)).toEqual([{ cueIndex: 1, top: 80 }]);
  });

  it('produces no anchors when measurement is disabled (narrow layout fallback)', () => {
    const { getByTestId } = render(
      <Harness fontScale={1} passageId="p1" tops={[[1, 40], [2, 80]]} enabled={false} />,
    );
    act(() => flushRaf());
    expect(readAnchors(getByTestId)).toEqual([]);
  });

  it('coalesces several measure requests in one frame into a single measurement', () => {
    render(<Harness fontScale={1} passageId="p1" tops={[[1, 40]]} />);
    // The mount + observer setup must not queue a separate rAF callback per trigger.
    expect(rafQueue.length).toBe(1);
  });
});

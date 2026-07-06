// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { useSentenceTracking } from './useSentenceTracking';

/**
 * jsdom has no IntersectionObserver, so we stub it: each instance records the elements it observes
 * and exposes `fire(indices)` to synthesize "these sentences are now visible" callbacks.
 */
class IOStub {
  static instances: IOStub[] = [];
  elements: Element[] = [];
  constructor(
    readonly cb: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    IOStub.instances.push(this);
  }
  observe(el: Element): void {
    this.elements.push(el);
  }
  unobserve(el: Element): void {
    this.elements = this.elements.filter((e) => e !== el);
  }
  disconnect(): void {
    this.elements = [];
  }
  fire(indices: number[]): void {
    const entries = indices.map((i) => ({
      isIntersecting: true,
      target: this.elements.find((e) => e.getAttribute('data-sentence-index') === String(i))!,
    }));
    this.cb(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  IOStub.instances.length = 0;
  vi.stubGlobal('IntersectionObserver', IOStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface HarnessProps {
  passageId: string;
  count: number;
  enabled?: boolean;
  resetKey?: number;
  onReach: (i: number) => void;
}

function Harness({ passageId, count, enabled = true, resetKey = 0, onReach }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useSentenceTracking({ containerRef, passageId, sentenceCount: count, enabled, resetKey, onReach });
  return (
    <div ref={containerRef}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} data-sentence-index={i}>
          s{i}
        </div>
      ))}
    </div>
  );
}

describe('useSentenceTracking', () => {
  it('reports the furthest sentence index that becomes visible', () => {
    const onReach = vi.fn();
    render(<Harness passageId="p1" count={5} onReach={onReach} />);
    act(() => IOStub.instances[0]!.fire([0, 1, 2]));
    expect(onReach).toHaveBeenLastCalledWith(2);
  });

  it('never rewinds the reported position when scrolling back up', () => {
    const onReach = vi.fn();
    render(<Harness passageId="p1" count={10} onReach={onReach} />);
    act(() => IOStub.instances[0]!.fire([4, 5]));
    expect(onReach).toHaveBeenLastCalledWith(5);
    onReach.mockClear();
    // Lower sentences re-entering the viewport (scroll up) must NOT lower the reported max.
    act(() => IOStub.instances[0]!.fire([2, 3]));
    expect(onReach).not.toHaveBeenCalled();
  });

  it('is a no-op (no observer) when disabled', () => {
    const onReach = vi.fn();
    render(<Harness passageId="p1" count={5} enabled={false} onReach={onReach} />);
    expect(IOStub.instances).toHaveLength(0);
    expect(onReach).not.toHaveBeenCalled();
  });

  it('re-subscribes with a fresh watermark when resetKey changes ("先頭から読む")', () => {
    const onReach = vi.fn();
    const { rerender } = render(<Harness passageId="p1" count={10} resetKey={0} onReach={onReach} />);
    act(() => IOStub.instances[0]!.fire([6]));
    expect(onReach).toHaveBeenLastCalledWith(6);

    rerender(<Harness passageId="p1" count={10} resetKey={1} onReach={onReach} />);
    expect(IOStub.instances).toHaveLength(2); // a new observer was created
    onReach.mockClear();
    // The fresh observer starts from -1, so a low sentence is reported again after the reset.
    act(() => IOStub.instances[1]!.fire([1]));
    expect(onReach).toHaveBeenLastCalledWith(1);
  });
});

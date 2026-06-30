// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useIsNarrow } from './useIsNarrow';

/** A controllable matchMedia stub so we can flip the viewport across the breakpoint. */
type Listener = (e: { matches: boolean }) => void;
let current: { matches: boolean; listeners: Listener[] } | null = null;

function setMatches(matches: boolean): void {
  if (!current) return;
  current.matches = matches;
  current.listeners.forEach((l) => l({ matches }));
}

beforeEach(() => {
  current = { matches: false, listeners: [] };
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return current!.matches;
    },
    addEventListener: (_: string, l: Listener) => current!.listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      current!.listeners = current!.listeners.filter((x) => x !== l);
    },
    // legacy API (some environments) — unused here but present for safety
    addListener: (l: Listener) => current!.listeners.push(l),
    removeListener: (l: Listener) => {
      current!.listeners = current!.listeners.filter((x) => x !== l);
    },
  }));
});

afterEach(() => vi.unstubAllGlobals());

function Harness({ query }: { query: string }) {
  const narrow = useIsNarrow(query);
  return <div data-testid="narrow">{String(narrow)}</div>;
}

describe('useIsNarrow', () => {
  it('reports the initial match state of the media query', () => {
    setMatches(true);
    const { getByTestId } = render(<Harness query="(max-width: 600px)" />);
    expect(getByTestId('narrow').textContent).toBe('true');
  });

  it('reports false when the query does not match (wide viewport)', () => {
    setMatches(false);
    const { getByTestId } = render(<Harness query="(max-width: 600px)" />);
    expect(getByTestId('narrow').textContent).toBe('false');
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const { getByTestId } = render(<Harness query="(max-width: 600px)" />);
    expect(getByTestId('narrow').textContent).toBe('false');
    act(() => setMatches(true));
    expect(getByTestId('narrow').textContent).toBe('true');
    act(() => setMatches(false));
    expect(getByTestId('narrow').textContent).toBe('false');
  });

  it('degrades to false when matchMedia is unavailable (SSR/host without it)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { getByTestId } = render(<Harness query="(max-width: 600px)" />);
    expect(getByTestId('narrow').textContent).toBe('false');
  });
});

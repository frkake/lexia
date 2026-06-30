/**
 * L4 — useIsNarrow: subscribes to a CSS media query (default the reading grid breakpoint,
 * `max-width: 1024px`) and returns whether it currently matches. Used to width-gate the 3-zone
 * reading layout: the two-sub-column grid (EN + JA side by side) and the line-aligned notice rail
 * engage ONLY on a real desktop width. Below it — the whole phone+tablet band — the grid reflows to
 * one column and the rail flattens (Requirement 3.3 fallback), because a sub-1024px main column is
 * too narrow to hold EN and JA side by side without strangling the English (GAP3).
 *
 * Degrades to `false` when `matchMedia` is unavailable (SSR / older host), so the layout simply
 * stays in its wide form rather than throwing.
 */

import { useEffect, useState } from 'react';

/**
 * The reading layout's wide-grid breakpoint. At/below 1024px the 3-zone grid reflows to a single
 * column; the matching `.sentence-row` reflow rule in global.css uses the same 1024px max-width.
 */
export const NARROW_QUERY = '(max-width: 1024px)';

export function useIsNarrow(query: string = NARROW_QUERY): boolean {
  const getMatch = (): boolean =>
    typeof matchMedia === 'function' ? matchMedia(query).matches : false;

  const [narrow, setNarrow] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const onChange = (e: MediaQueryListEvent | { matches: boolean }): void => setNarrow(e.matches);
    // Sync once in case the query changed between render and effect.
    setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}

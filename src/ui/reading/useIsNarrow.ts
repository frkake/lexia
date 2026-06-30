/**
 * L4 — useIsNarrow: subscribes to a CSS media query (default the reading mobile breakpoint,
 * `max-width: 600px`) and returns whether it currently matches. Used to width-gate the 3-zone
 * reading layout's line-alignment: on narrow viewports the notice rail flattens and the grid
 * reflows to one column (Requirement 3.3 mobile fallback) instead of staying line-aligned.
 *
 * Degrades to `false` when `matchMedia` is unavailable (SSR / older host), so the layout simply
 * stays in its wide form rather than throwing.
 */

import { useEffect, useState } from 'react';

/** The reading layout's mobile breakpoint — mirrors the `@media (max-width: 600px)` in global.css. */
export const NARROW_QUERY = '(max-width: 600px)';

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

/**
 * L4 — AppContext: provides the composition-root Container to the screen tree. Routes
 * read their dependencies (repos, adapters, stores, controllers' deps) from here instead
 * of importing infrastructure directly, keeping the UI testable behind a fake container.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Container } from './container';

const AppContext = createContext<Container | null>(null);

export function AppProvider({ container, children }: { container: Container; children: ReactNode }) {
  return <AppContext.Provider value={container}>{children}</AppContext.Provider>;
}

/** Access the app container (throws if used outside an AppProvider). */
export function useContainer(): Container {
  const container = useContext(AppContext);
  if (!container) throw new Error('useContainer must be used within an AppProvider');
  return container;
}

/** Access the app container when a component can also run in isolated tests. */
export function useOptionalContainer(): Container | null {
  return useContext(AppContext);
}

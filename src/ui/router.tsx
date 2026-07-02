/**
 * L4 — router: the client routes under the resident AppShell (design.md
 * "router.tsx", 12.1). `createBrowserRouter` is built lazily (it touches window.history)
 * so importing the route table stays side-effect free for tests. Each route mounts its
 * container (src/ui/app/routes.tsx), which wires the screen to live data + the flow
 * controllers via the AppContext container.
 */

import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import {
  HomeRoute,
  LibraryRoute,
  ReadingRoute,
  ReviewRoute,
  StoryDirectoryRoute,
  WordbookRoute,
} from './app/routes';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'library', element: <LibraryRoute /> },
      { path: 'p/:passageId', element: <ReadingRoute /> },
      { path: 's/:storyId', element: <StoryDirectoryRoute /> },
      { path: 's/:storyId/:chapterIndex', element: <ReadingRoute /> },
      { path: 'review', element: <ReviewRoute /> },
      { path: 'wordbook', element: <WordbookRoute /> },
    ],
  },
];

/** Build the browser router (call once at app startup). */
export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { appRoutes } from './router';
import { AppShell } from './AppShell';
import { NotFoundRoute, RouteErrorBoundary, WordPageRoute } from './app/routes';

describe('appRoutes', () => {
  it('mounts the AppShell as the layout route', () => {
    expect(appRoutes).toHaveLength(1);
    expect(appRoutes[0]!.path).toBe('/');
    expect(appRoutes[0]!.element).toEqual(<AppShell />);
  });

  it('guards the shell with a route error boundary (no white screen on route errors)', () => {
    expect(appRoutes[0]!.errorElement).toEqual(<RouteErrorBoundary />);
  });

  it('wires the new IA destinations under the shell', () => {
    const children = appRoutes[0]!.children ?? [];
    const hasIndex = children.some((c) => 'index' in c && c.index); // home (generation)
    const paths = children.flatMap((c) => ('path' in c && c.path ? [c.path] : []));
    expect(hasIndex).toBe(true);
    expect(paths).toEqual(
      expect.arrayContaining([
        'library',
        'p/:passageId',
        's/:storyId',
        's/:storyId/characters/:characterIndex',
        's/:storyId/:chapterIndex',
        'review',
        'wordbook',
      ]),
    );
    // The retired tabs are gone.
    expect(paths).not.toContain('read');
    expect(paths).not.toContain('setup');
  });

  it('adds the URL-addressable single word page (/w/:wordId — D-5・E-3 basis)', () => {
    const children = appRoutes[0]!.children ?? [];
    const wordRoute = children.find((c) => 'path' in c && c.path === 'w/:wordId');
    expect(wordRoute).toBeDefined();
    expect(wordRoute!.element).toEqual(<WordPageRoute />);
  });

  it('adds a catch-all 404 route as the last child', () => {
    const children = appRoutes[0]!.children ?? [];
    const catchAll = children.find((c) => 'path' in c && c.path === '*');
    expect(catchAll).toBeDefined();
    expect(catchAll!.element).toEqual(<NotFoundRoute />);
    // The wildcard must not shadow the concrete destinations: it comes last.
    const paths = children.flatMap((c) => ('path' in c && c.path ? [c.path] : []));
    expect(paths[paths.length - 1]).toBe('*');
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { appRoutes } from './router';
import { AppShell } from './AppShell';

describe('appRoutes', () => {
  it('mounts the AppShell as the layout route', () => {
    expect(appRoutes).toHaveLength(1);
    expect(appRoutes[0]!.path).toBe('/');
    expect(appRoutes[0]!.element).toEqual(<AppShell />);
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
});

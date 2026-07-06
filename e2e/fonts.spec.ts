import { test, expect } from '@playwright/test';

/**
 * F-7: the design fonts are self-hosted via @fontsource (imported in src/main.tsx)
 * so any environment — including a font-less CI container — renders the intended
 * typography instead of an OS fallback. We drive the font faces to load and assert
 * document.fonts.check() reports them available.
 */
test('self-hosted design fonts are available (F-7)', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('19px "Newsreader Variable"'),
      document.fonts.load('600 19px "IBM Plex Sans"'),
    ]);
    await document.fonts.ready;
    return {
      newsreader: document.fonts.check('19px "Newsreader Variable"'),
      plex: document.fonts.check('600 19px "IBM Plex Sans"'),
    };
  });
  expect(result.newsreader).toBe(true);
  expect(result.plex).toBe(true);
});

import { test, expect } from '@playwright/test';
import { mockApi, generateFromSetup, ensureSeekable, seek } from './helpers';

/**
 * 11.2 E2E — the iPhone Reading frame on the Safari (WebKit) engine: the docked player is
 * fixed to the bottom inside the safe area, the mobile back/meta header is present, and the
 * follow-along highlight tracks the playhead on WebKit too. Runs only on the mobile project.
 */

test.skip(({ viewport }) => !viewport || viewport.width > 600, 'mobile layout only');

test.describe('mobile reading (iPhone / Safari engine)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test('docks the player to the bottom and shows the mobile back/meta header', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/p\//);

    const player = page.locator('.bottom-player');
    await expect(player).toBeVisible();
    // The mobile breakpoint fixes the dock to the bottom of the viewport.
    const box = await player.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, bottom: cs.bottom, radius: cs.borderTopLeftRadius };
    });
    expect(box.position).toBe('fixed');
    expect(box.bottom).toBe('0px');
    expect(parseFloat(box.radius)).toBeGreaterThan(0); // 22px rounded dock top

    // Mobile header affordances (back + compact meta).
    await expect(page.getByRole('button', { name: '戻る' })).toBeVisible();
    await expect(page.locator('.reading-layout')).toHaveCSS('flex-direction', 'column');
  });

  test('reflows the sentence grid to one column so the Japanese drops below the English (Req 3.3)', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/p\//);

    // F-8①: the right-cell Japanese aside only renders when translation is enabled (default is off →
    // single-column, no aside). Turn on 全文 so the two-column grid is active and the mobile reflow
    // (aside drops below the English) is actually exercised.
    await page.getByRole('button', { name: '全文' }).click();

    // New 3-zone layout is active (grid), but at <=1024px the per-sentence grid collapses to a
    // single column — the right-cell Japanese reflows directly below its English sentence.
    await expect(page.getByTestId('passage-prose')).toHaveAttribute('data-layout', 'grid');
    const columns = await page
      .getByTestId('sentence-row-0')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // One resolved track (a single "<px>" value), not the wide two-column template.
    expect(columns.trim().split(/\s+/).length).toBe(1);

    // The English cell and its Japanese aside both render (aside reflowed below, not to the side).
    await expect(page.getByTestId('sentence-en-0')).toBeVisible();
    const enBox = await page.getByTestId('sentence-en-0').boundingBox();
    const asideBox = await page.getByTestId('sentence-aside-0').boundingBox();
    expect(enBox && asideBox && asideBox.y >= enBox.y).toBeTruthy(); // aside sits at/below the EN
  });

  test('follow-along highlight tracks the playhead on WebKit', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/p\//);
    await expect(page.getByRole('button', { name: '再生', exact: true })).toBeEnabled();
    await ensureSeekable(page);

    await seek(page, 0.35); // → the "decisive" mark window
    await expect(page.locator('[data-active="true"]')).toHaveText('decisive');
  });
});

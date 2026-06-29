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
    await page.waitForURL(/\/read$/);

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
  });

  test('follow-along highlight tracks the playhead on WebKit', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/read$/);
    await expect(page.getByRole('button', { name: '再生', exact: true })).toBeEnabled();
    await ensureSeekable(page);

    await seek(page, 0.35); // → the "decisive" mark window
    await expect(page.locator('[data-active="true"]')).toHaveText('decisive');
  });
});

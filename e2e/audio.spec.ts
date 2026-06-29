import { test, expect } from '@playwright/test';
import { mockApi, generateFromSetup, ensureSeekable, seek } from './helpers';

/**
 * 11.2 E2E — pre-generated TTS follow-along. The mocked synthesis returns a real (silent)
 * WAV + byte-accurate word marks; seeking drives the HighlightController (binary search by
 * token) so the spoken token's annotation is emphasized, and the rate control changes the
 * element's playbackRate. Seeking is synchronous, so the assertion is deterministic without
 * depending on real-time audio playback.
 */

test.describe('audio follow-along', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test('seeking moves the follow-along highlight to the spoken token', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/read$/);
    // Audio readied (the player is enabled once the TimingMap arrives).
    await expect(page.getByRole('button', { name: '再生', exact: true })).toBeEnabled();
    await ensureSeekable(page);

    // ~1.4s lands inside the "decisive" (token 3) mark window [1.2s, 1.6s).
    await seek(page, 0.35);
    await expect(page.locator('[data-active="true"]')).toHaveText('decisive');

    // ~0.08s is the first word ("We", not a target) → nothing emphasized.
    await seek(page, 0.02);
    await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  });

  test('the rate control cycles the playback speed', async ({ page }) => {
    await generateFromSetup(page);
    await page.waitForURL(/\/read$/);
    await expect(page.getByRole('button', { name: '再生', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: '再生速度 1倍' }).click();
    await expect(page.getByRole('button', { name: '再生速度 1.25倍' })).toBeVisible();
    const rate = await page.evaluate(() => document.querySelector('audio')!.playbackRate);
    expect(rate).toBeCloseTo(1.25);
  });
});

import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 11.4 visual regression — each of the 6 mock frames is rendered from deterministic
 * fixtures in the gallery and screenshotted per project (desktop = PC frames, mobile-webkit
 * = iPhone frames at 414×842). Beyond pixel stability, the load-bearing design tokens are
 * asserted explicitly against design.md "Design Tokens": the state-by-state annotation
 * encoding, the 4-stage mastery colors and the notice-category chip colors.
 */

const SCREENS = ['dashboard', 'reading', 'reading-grid', 'wordcard', 'review', 'setup', 'wordbook'] as const;

/** "#rrggbb" → the "rgb(r, g, b)" string getComputedStyle returns. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function styleOf(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate(
    (el, p) => getComputedStyle(el)[p as keyof CSSStyleDeclaration] as string,
    prop,
  );
}

async function openGallery(page: Page, screen: string): Promise<void> {
  await page.goto(`/gallery.html#${screen}`);
  await page.getByTestId('gallery-ready').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('visual baselines', () => {
  for (const screen of SCREENS) {
    test(`frame: ${screen}`, async ({ page }) => {
      await openGallery(page, screen);
      await expect(page).toHaveScreenshot(`${screen}.png`, { fullPage: true });
    });
  }
});

test('tokens: annotation encoding + notice chips (design.md 状態別注釈エンコード)', async ({ page }) => {
  await openGallery(page, 'reading');

  // Mastery-density underlines: 新出 solid #4C7BC0 / 学習中 solid #8FB0DA / 定着 dotted #C4CCD6.
  expect(await styleOf(page.locator('[data-kind="new"]').first(), 'borderBottomColor')).toBe(rgb('#4C7BC0'));
  expect(await styleOf(page.locator('[data-kind="new"]').first(), 'borderBottomStyle')).toBe('solid');
  expect(await styleOf(page.locator('[data-kind="review"]').first(), 'borderBottomColor')).toBe(rgb('#8FB0DA'));
  expect(await styleOf(page.locator('[data-kind="known"]').first(), 'borderBottomColor')).toBe(rgb('#C4CCD6'));
  expect(await styleOf(page.locator('[data-kind="known"]').first(), 'borderBottomStyle')).toBe('dotted');

  // Collocation tint #E4EDF8.
  expect(await styleOf(page.locator('[data-kind="collocation"]').first(), 'backgroundColor')).toBe(rgb('#E4EDF8'));

  // Notice number badges: connotation #4C9A86 / register #6B7686 / collocation #3D6CB0.
  expect(await styleOf(page.getByTestId('notice-badge-1'), 'backgroundColor')).toBe(rgb('#4C9A86'));
  expect(await styleOf(page.getByTestId('notice-badge-2'), 'backgroundColor')).toBe(rgb('#6B7686'));
  expect(await styleOf(page.getByTestId('notice-badge-3'), 'backgroundColor')).toBe(rgb('#3D6CB0'));
});

test('layout: new 3-zone reading renders the sentence grid + JA-side new-element emphasis (6.1/4.1)', async ({ page }) => {
  await openGallery(page, 'reading-grid');
  // Sentence-unit 2-column grid: English left cell + translation right cell.
  await expect(page.getByTestId('passage-prose')).toHaveAttribute('data-layout', 'grid');
  await expect(page.getByTestId('sentence-en-0')).toBeVisible();
  await expect(page.getByTestId('sentence-aside-0')).toBeVisible();
  // The new-element emphasis underlines the JA slice for a new word.
  await expect(page.locator('[data-translation-new="true"]').first()).toBeVisible();
});

test('tokens: dashboard 4-stage mastery breakdown colors', async ({ page }) => {
  await openGallery(page, 'dashboard');
  expect(await styleOf(page.getByTestId('mastery-seg-new'), 'backgroundColor')).toBe(rgb('#C4CCD6'));
  expect(await styleOf(page.getByTestId('mastery-seg-learning'), 'backgroundColor')).toBe(rgb('#8FB0DA'));
  expect(await styleOf(page.getByTestId('mastery-seg-consolidating'), 'backgroundColor')).toBe(rgb('#4C7BC0'));
  expect(await styleOf(page.getByTestId('mastery-seg-mastered'), 'backgroundColor')).toBe(rgb('#4C9A86'));
});

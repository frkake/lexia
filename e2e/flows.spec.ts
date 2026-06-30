import { test, expect } from '@playwright/test';
import { mockApi, generateFromSetup } from './helpers';

/**
 * 11.2 E2E — the primary learning journey on the PC layout: Setup → generate → Reading,
 * annotated target words, word-detail lookup, the font-size control, the translation-mode
 * toggle, and the resident-player survival across client-side navigation.
 */

test.describe('reading flow (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test('Setup generates a passage and lands on Reading with the annotated target', async ({ page }) => {
    await generateFromSetup(page);
    await expect(page).toHaveURL(/\/read$/);
    await expect(page.getByRole('heading', { name: 'A Decisive Agreement' })).toBeVisible();
    // The woven-in new word carries the "new" mastery-density annotation.
    await expect(page.locator('[data-kind="new"]')).toHaveText('decisive');
    // The compact back/meta header is mobile-only; desktop should not show it.
    if ((page.viewportSize()?.width ?? 0) > 600) {
      await expect(page.getByRole('button', { name: '戻る' })).toBeHidden();
    }
  });

  test('selecting a word opens its multi-faceted detail card', async ({ page }) => {
    await generateFromSetup(page);
    await page.locator('[data-kind="new"]').click();
    const dialog = page.getByRole('dialog', { name: '単語詳細' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('/dɪˈsaɪsɪv/')).toBeVisible(); // IPA (unique)
    await expect(dialog.getByText('断固とした')).toBeVisible(); // a core meaning (unique)
    await expect(dialog.getByText('コノテーション: 肯定的')).toBeVisible();
  });

  test('the font-size control enlarges the prose', async ({ page }) => {
    await generateFromSetup(page);
    const prose = page.getByTestId('passage-prose');
    const before = await prose.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.getByRole('button', { name: '文字を大きく' }).click();
    await expect(async () => {
      const after = await prose.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(after).toBeGreaterThan(before);
    }).toPass();
  });

  test('translation mode reveals the sentence gloss', async ({ page }) => {
    await generateFromSetup(page);
    const gloss = page.getByText('私たちは決定的な合意に達した。');
    await expect(gloss).toHaveCount(0); // off by default
    await page.getByRole('button', { name: '全文' }).click();
    await expect(gloss).toBeVisible();
  });

  test('emphasizes the new word on the Japanese side through the real generate→render path (Req 4)', async ({ page }) => {
    // Exercises the WHOLE path: generated passage (with translationSpans) → store → IndexedPassage
    // → ReadingScreen right cell → SentenceTranslation underline. Guards against the wiring silently
    // breaking even though the gallery fixture covers the component in isolation.
    await generateFromSetup(page);
    await page.getByRole('button', { name: '全文' }).click();
    const newMark = page.locator('[data-translation-new="true"]');
    await expect(newMark).toHaveText('決定的'); // the new word's JA, underlined
    // Only the new element is underlined, not the whole gloss.
    await expect(newMark).toHaveCount(1);
  });
});

test('Setup can generate a passage without target words when the backend is absent', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('button', { name: '文章を生成する' }).click();
  await expect(page).toHaveURL(/\/read$/);
  await expect(page.getByRole('heading', { name: 'ビジネスの短い読解' })).toBeVisible();
});

test('the resident audio element survives client-side navigation', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByTestId('app-audio').evaluate((el) => el.setAttribute('data-marker', 'kept'));
  await page.getByRole('link', { name: '復習' }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole('link', { name: '読む' }).click();
  await expect(page).toHaveURL(/\/read$/);
  // Same element instance — the AppShell layout (and its <audio>) never remounts.
  await expect(page.getByTestId('app-audio')).toHaveAttribute('data-marker', 'kept');
});

import { test, expect } from '@playwright/test';

test('the app shell boots with the resident audio element', async ({ page }) => {
  await page.goto('/');
  // AppShell mounts the single resident <audio> for the whole session.
  await expect(page.getByTestId('app-audio')).toBeAttached();
  // The docked player is present from first paint.
  await expect(page.getByText('· Listen')).toBeVisible();
});

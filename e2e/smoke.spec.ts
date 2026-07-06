import { test, expect } from '@playwright/test';

test('the app shell boots with the resident audio element', async ({ page }) => {
  await page.goto('/');
  // AppShell mounts the single resident <audio> for the whole session — from first paint,
  // outside the router Outlet, so it survives navigation.
  await expect(page.getByTestId('app-audio')).toBeAttached();
  // D-8: the docked listen bar only appears when there is an open passage to play. On the
  // home route (nothing to read) the dead, silent player is not rendered.
  await expect(page.getByText('· Listen')).toHaveCount(0);
});

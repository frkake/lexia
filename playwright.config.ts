import { defineConfig } from '@playwright/test';

/**
 * E2E + visual-regression harness (tasks 11.2 / 11.4). Two projects exercise the two
 * target environments from the spec:
 *   - desktop-chromium: the PC frames (Dashboard / Reading / WordCard / Review / Setup).
 *   - mobile-webkit: the Safari engine at the iPhone viewport (414×842) for the iPhone
 *     Reading frame and the docked mobile player.
 * The dev server serves both the real app (index.html — driven with mocked /api/*) and
 * the deterministic visual gallery (gallery.html). Screenshots are stored per project.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: {
    timeout: 7_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 414, height: 842 },
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots of the main screens for design review (not a test gate).
 * Runs in the "Screenshots" workflow, which commits the images to the
 * branch screenshots/<branch>.
 */
export default defineConfig({
  testDir: 'tests/screens',
  outputDir: 'test-results/screens',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'de-DE',
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'npm run build:browser && npx vite preview --config vite.browser.config.ts',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

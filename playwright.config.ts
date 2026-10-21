import { defineConfig, devices } from '@playwright/test';

/** UI tests in browser mode (mock adapter, no file system). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    locale: 'de-DE',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    // The production build, so the strict Content Security Policy applies
    // (the dev server needs inline styles). Set E2E_DEV=1 to test against
    // the running dev server instead.
    command: process.env.E2E_DEV ? 'npm run dev:browser' : 'npm run build:browser && npx vite preview --config vite.browser.config.ts',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

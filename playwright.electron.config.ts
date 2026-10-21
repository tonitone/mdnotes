import { defineConfig } from '@playwright/test';

/** Smoke tests of the built Electron app (run `npm run build` first). */
export default defineConfig({
  testDir: 'tests/electron',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
});

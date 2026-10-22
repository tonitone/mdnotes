import { expect, test as base } from '@playwright/test';

/**
 * The shared test object for all e2e tests.
 *
 * - After every test it checks that the page reported no Content Security
 *   Policy violations (collected by src/renderer/csp-report.ts).
 * - When a test fails, page errors and console errors are added to the
 *   failure, so CI annotations show what went wrong in the page.
 */
export const test = base.extend<{ cspCheck: void }>({
  cspCheck: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      await use();
      if (testInfo.status !== testInfo.expectedStatus && errors.length > 0) {
        throw new Error(`Errors in the page:\n${errors.slice(0, 20).join('\n')}`);
      }
      if (page.isClosed() || page.url() === 'about:blank') return;
      const violations = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [] as string[]);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

import { expect, test as base } from '@playwright/test';

/**
 * The shared test object for all e2e tests. After every test it checks that
 * the page reported no Content Security Policy violations (collected by
 * src/renderer/csp-report.ts).
 */
export const test = base.extend<{ cspCheck: void }>({
  cspCheck: [
    async ({ page }, use) => {
      await use();
      if (page.isClosed() || page.url() === 'about:blank') return;
      const violations = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [] as string[]);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

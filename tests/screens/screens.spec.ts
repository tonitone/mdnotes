import { expect, test, type Page } from '@playwright/test';

/** Captures the main screen in every look (light and dark) into screenshots/. */

async function open(page: Page, look: string, theme: string) {
  await page.addInitScript(
    ([l, th]) => {
      localStorage.setItem('mdnotes.look', l);
      localStorage.setItem('mdnotes.theme', th);
    },
    [look, theme],
  );
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();
  await page.locator('#notesList ui5-li').filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
  // Cursor to the end, so the first lines show the live preview.
  await page.keyboard.press('Control+End');
  await page.locator('#libraryList').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(700);
}

for (const look of ['standard', 'fiori', 'macos'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${look} ${theme}`, async ({ page }) => {
      await open(page, look, theme);
      await page.screenshot({ path: `screenshots/${look}-${theme}.png`, animations: 'disabled' });
    });
  }
}

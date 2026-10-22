import { expect, test, type Page } from '@playwright/test';

/** Captures the main screens in light and dark theme into screenshots/. */

const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, animations: 'disabled' });

async function open(page: Page, theme: string, note = 'Willkommen') {
  await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();
  if (note) {
    await page.locator('#notesList ui5-li').filter({ hasText: note }).first().click();
    await expect(page.locator('.cm-content')).toBeVisible();
  }
  // Move the cursor to the end, so the first lines show the live preview.
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(500);
}

for (const theme of ['light', 'dark'] as const) {
  test(`main ${theme}`, async ({ page }) => {
    await open(page, theme);
    await shot(page, `01-main-${theme}`);
  });

  test(`sprint ${theme}`, async ({ page }) => {
    await open(page, theme, 'Sprint-Planung');
    await shot(page, `02-sprint-${theme}`);
  });
}

test('empty selection', async ({ page }) => {
  await open(page, 'light', '');
  await shot(page, '03-empty');
});

test('versions dialog', async ({ page }) => {
  await open(page, 'light', 'Sprint-Planung');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nNeue Zeile');
  await page.locator('#versionsButton').click();
  await expect(page.locator('ui5-dialog .cm-mergeView')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '04-versions');
});

test('backup dialog', async ({ page }) => {
  await open(page, 'light');
  await page.locator('#backupItem').click();
  await page.locator('ui5-dialog ui5-button', { hasText: 'Jetzt sichern' }).click();
  await expect(page.locator('ui5-dialog ui5-list ui5-li')).toHaveCount(1);
  await page.waitForTimeout(800);
  await shot(page, '05-backup');
});

test('narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page, 'light', '');
  await shot(page, '06-narrow-list');
  await page.locator('#notesList ui5-li').first().click();
  await page.waitForTimeout(500);
  await shot(page, '07-narrow-editor');
});

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const dialog = (page: Page) => page.locator('ui5-dialog');

async function openApp(page: Page) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
}

test('Ctrl+/ opens the shortcut overview and Esc closes it', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Tastenkürzel');
  await expect(dialog(page)).toContainText('Neue Notiz');
  await expect(dialog(page)).toContainText('Strg+N');
  await expect(dialog(page)).toContainText('Strg+Umschalt+X');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

test('Ctrl+/ also works inside the editor and does not stack dialogs', async ({ page }) => {
  await openApp(page);
  await listItems(page).first().click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toHaveCount(1);
  await page.locator('ui5-dialog ui5-button', { hasText: 'Schließen' }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test('the overview follows the language', async ({ page }) => {
  await openApp(page);
  await page.locator('#languageItem').click();
  await page.locator('#languageMenu ui5-menu-item[data-language="en"]').click();
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toContainText('Keyboard shortcuts');
  await expect(dialog(page)).toContainText('Ctrl+Shift+X');
});

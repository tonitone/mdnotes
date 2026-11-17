import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const dialog = (page: Page) => page.locator('ui5-dialog');

async function openOutline(page: Page) {
  await page.locator('#editorMoreButton').click();
  await page.locator('#editorMoreMenu ui5-menu-item[data-action="outline"]').click();
  await expect(dialog(page)).toBeVisible();
}

async function openWelcome(page: Page) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

test('the outline lists the headings of the note', async ({ page }) => {
  await openWelcome(page);
  await openOutline(page);
  const items = dialog(page).locator('ui5-li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Willkommen bei mdnotes');
  await expect(items.nth(0)).toContainText('Ebene 1');
  await expect(items.nth(1)).toContainText('Live Preview');
  await expect(items.nth(1)).toContainText('Ebene 2');
});

test('choosing a heading moves the cursor there and returns to the editor', async ({ page }) => {
  await openWelcome(page);
  await openOutline(page);
  await dialog(page).locator('ui5-li', { hasText: 'Live Preview' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.cm-activeLine')).toContainText('Live Preview');
});

test('Esc closes the outline without moving the cursor', async ({ page }) => {
  await openWelcome(page);
  await openOutline(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

test('a note without headings shows an empty message', async ({ page }) => {
  await openWelcome(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Nur Text');
  await openOutline(page);
  await expect(dialog(page).locator('ui5-li')).toHaveCount(0);
  await expect(dialog(page)).toContainText('Diese Notiz hat keine Überschriften.');
});

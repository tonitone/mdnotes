import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './axe';
import { expect, test } from './fixtures';

/** Middle column header: title and "New note" button never overlap, the button name stays the same. */

const listItems = (page: Page) => page.locator('#notesList ui5-li');

// With a note open the layout has three columns; the middle one is about a quarter of the window.
async function openWithNote(page: Page, width: number, rootFontSize?: string) {
  await page.setViewportSize({ width, height: 800 });
  // A larger root font size makes the 17 rem threshold wider than the column.
  if (rootFontSize) await page.addInitScript((size) => void (document.documentElement.style.fontSize = size), rootFontSize);
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function checkHeader(page: Page, compact: boolean) {
  const column = page.locator('section[slot="midColumn"]');
  const box = await column.boundingBox();
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  // Guards the premise of the test: the window really gives the expected column width.
  expect(box!.width < 17 * rem).toBe(compact);

  const button = page.locator('#newNoteButton');
  await expect(button).toHaveAttribute('accessible-name', 'Neue Notiz');
  await expect(button).toHaveAttribute('tooltip', 'Neue Notiz');
  await expect(page.getByRole('button', { name: 'Neue Notiz' })).toBeVisible();
  if (compact) await expect(button).toHaveText('');
  else await expect(button).toHaveText('Neue Notiz');

  const title = (await page.locator('#notesTitle').boundingBox())!;
  const action = (await button.boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(action.x + 0.5);
}

test('narrow middle column: icon-only button, no overlap, axe', async ({ page }) => {
  await openWithNote(page, 1400, '32px');
  await checkHeader(page, true);
  await expectNoSeriousViolations(page, 'narrow middle column');
});

test('wide middle column: icon and text, no overlap, axe', async ({ page }) => {
  await openWithNote(page, 1400);
  await checkHeader(page, false);
  await expectNoSeriousViolations(page, 'wide middle column');
});

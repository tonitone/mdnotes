import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './axe';
import { expect, test } from './fixtures';

/** Middle column header: title and "New note" button never overlap, the button name stays the same. */

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const column = (page: Page) => page.locator('section[slot="midColumn"]');

async function columnWidth(page: Page): Promise<number> {
  return (await column(page).boundingBox())!.width;
}

// With a note open the layout has three columns. The window is resized until the
// middle column has the wanted width at the normal root font size.
async function openWithNote(page: Page, columnPx: number) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await resizeColumnTo(page, columnPx);
}

async function resizeColumnTo(page: Page, columnPx: number) {
  const current = await columnWidth(page);
  const width = Math.round((1400 * columnPx) / current);
  await page.setViewportSize({ width, height: 800 });
  await expect.poll(async () => Math.abs((await columnWidth(page)) - columnPx)).toBeLessThan(8);
}

async function checkHeader(page: Page, compact: boolean) {
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(rem).toBe(16);
  // Guards the premise of the test: the column has the expected width.
  expect((await columnWidth(page)) < 17 * rem).toBe(compact);

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

test('narrow middle column (about 255 px): icon-only button, no overlap, axe', async ({ page }) => {
  await openWithNote(page, 255);
  await checkHeader(page, true);
  await expectNoSeriousViolations(page, 'narrow middle column');
});

test('wide middle column: icon and text, no overlap, axe', async ({ page }) => {
  await openWithNote(page, 350);
  await checkHeader(page, false);
  await expectNoSeriousViolations(page, 'wide middle column');
});

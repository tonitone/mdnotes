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

/** Right edge of the real title text (not of the ui5-title box, which ends before the buttons anyway). */
async function titleTextRight(page: Page): Promise<number> {
  return page.locator('#notesTitle').evaluate((title) => {
    const range = document.createRange();
    range.selectNodeContents(title);
    return range.getBoundingClientRect().right;
  });
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

  // The whole title text ends before the first header action.
  const first = (await page.locator('.header-actions ui5-button:not([hidden])').first().boundingBox())!;
  expect(await titleTextRight(page)).toBeLessThanOrEqual(first.x + 0.5);
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

test('long label name: the title is cut off before the buttons', async ({ page }) => {
  await openWithNote(page, 350);
  await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
  await page.locator('#renameLabelButton').click();
  const input = page.locator('ui5-dialog ui5-input input');
  await input.fill('Ein sehr langer Labelname fuer das Projekt Sommerfest');
  await input.press('Enter');
  const title = page.locator('#notesTitle');
  await expect(title).toHaveText('Label: Ein sehr langer Labelname fuer das Projekt Sommerfest');

  const box = (await title.boundingBox())!;
  const first = (await page.locator('.header-actions ui5-button:not([hidden])').first().boundingBox())!;
  // Premise: the text really is longer than the room it gets.
  expect(await titleTextRight(page)).toBeGreaterThan(first.x);
  // The title box ends before the buttons.
  expect(box.x + box.width).toBeLessThanOrEqual(first.x + 0.5);
  // The overflow is clipped with an ellipsis inside the ui5-title (wrapping-type="None"), not just hidden.
  await expect(title).toHaveAttribute('wrapping-type', 'None');
  const ellipsis = await title.evaluate((host) =>
    Array.from(host.shadowRoot?.querySelectorAll('*') ?? []).some((node) => getComputedStyle(node).textOverflow === 'ellipsis'),
  );
  expect(ellipsis).toBe(true);
});

test('label view just above its threshold: text button and the whole title fit', async ({ page }) => {
  // The rename button needs room: the label view switches to the icon below 22 rem (352 px).
  await openWithNote(page, 360);
  await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
  await expect(page.locator('#renameLabelButton')).toBeVisible();
  await expect(page.locator('#newNoteButton')).toHaveText('Neue Notiz');

  const title = page.locator('#notesTitle');
  await expect(title).toHaveText('Label: arbeit');
  const box = (await title.boundingBox())!;
  const first = (await page.locator('.header-actions ui5-button:not([hidden])').first().boundingBox())!;
  const textRight = await titleTextRight(page);
  // Not cut off and not covered.
  expect(textRight).toBeLessThanOrEqual(box.x + box.width + 0.5);
  expect(textRight).toBeLessThanOrEqual(first.x + 0.5);
});

test('label view in a narrow column: icon-only button', async ({ page }) => {
  await openWithNote(page, 300);
  await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
  await expect(page.locator('#renameLabelButton')).toBeVisible();
  await expect(page.locator('#newNoteButton')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Neue Notiz' })).toBeVisible();
});

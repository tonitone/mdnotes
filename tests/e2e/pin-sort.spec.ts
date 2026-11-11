import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Pinning, sort order and date groups in the note list (issue #18).
 *
 * Browser mode keeps notes in memory only, so pins do not survive a reload
 * here; that part is covered by the Electron smoke test. The sort order is an
 * app setting and does survive a reload.
 */

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const groups = (page: Page) => page.locator('#notesList ui5-li-group');
const group = (page: Page, title: string) => page.locator(`#notesList ui5-li-group[header-text="${title}"]`);
const item = (page: Page, title: string) => listItems(page).filter({ hasText: title }).first();
const titles = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#notesList ui5-li')].map((li) => li.textContent?.trim() ?? ''));
const isFocused = (locator: Locator) => locator.evaluate((node) => node === document.activeElement);

test.use({ timezoneId: 'Europe/Berlin' });

async function openApp(page: Page) {
  // A fixed "now" at noon: the demo notes were created 1 minute, 90 minutes and 26 hours earlier.
  // Timers keep running, only the date is fixed.
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+01:00'));
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
}

async function chooseSort(page: Page, sort: 'modified' | 'created' | 'title') {
  await page.locator('#sortButton').click();
  await expect(page.locator('#sortMenu')).toHaveJSProperty('open', true);
  await page.locator(`#sortMenu ui5-menu-item[data-sort="${sort}"]`).click();
  await expect(page.locator('#sortMenu')).toHaveJSProperty('open', false);
}

async function pinFromEditorMenu(page: Page, title: string) {
  await item(page, title).click();
  await expect(page.locator('.cm-content')).toContainText(title);
  await page.locator('#editorMoreButton').click();
  await expect(page.locator('#pinMenuItem')).toHaveAttribute('text', 'Anheften');
  await page.locator('#pinMenuItem').click();
  await expect(group(page, 'Angeheftet').locator('ui5-li')).toContainText(title);
}

test('default order: by modification date, grouped, newest first', async ({ page }) => {
  await openApp(page);
  // The demo files are all written at start-up, so all of them were modified today.
  await expect(groups(page)).toHaveCount(1);
  await expect(group(page, 'Heute').locator('ui5-li')).toHaveCount(3);
  await expect(listItems(page).first()).toContainText('Willkommen bei mdnotes');
  await expect(page.locator('#sortMenu ui5-menu-item[data-sort="modified"]')).toHaveJSProperty('checked', true);
  await expect(page.locator('#sortButton')).toHaveAttribute('accessible-name', 'Sortieren: Änderungsdatum');
});

test('sort by date created: Today and Yesterday groups; the choice survives a reload', async ({ page }) => {
  await openApp(page);
  await chooseSort(page, 'created');
  await expect(groups(page)).toHaveCount(2);
  await expect(groups(page).first()).toHaveAttribute('header-text', 'Heute');
  await expect(group(page, 'Heute').locator('ui5-li')).toHaveCount(2);
  await expect(group(page, 'Gestern').locator('ui5-li')).toContainText('Einkauf');
  await expect.poll(() => titles(page)).toEqual(['Willkommen bei mdnotes', 'Sprint-Planung', 'Einkauf']);
  await expect(page.locator('#sortButton')).toHaveAttribute('tooltip', 'Sortieren: Erstelldatum');
  await expect(page.locator('#announcer')).toHaveText('Sortiert nach Erstelldatum.');

  await page.reload();
  await expect(listItems(page).first()).toBeVisible();
  await expect(groups(page)).toHaveCount(2);
  await expect(page.locator('#sortMenu ui5-menu-item[data-sort="created"]')).toHaveJSProperty('checked', true);
  await expect(page.locator('#sortMenu ui5-menu-item[data-sort="modified"]')).toHaveJSProperty('checked', false);
});

test('sort by title: A to Z without groups; a search shows no groups either', async ({ page }) => {
  await openApp(page);
  await chooseSort(page, 'title');
  await expect(groups(page)).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual(['Einkauf', 'Sprint-Planung', 'Willkommen bei mdnotes']);
  // Choosing the checked entry again keeps it checked.
  await chooseSort(page, 'title');
  await expect(page.locator('#sortMenu ui5-menu-item[data-sort="title"]')).toHaveJSProperty('checked', true);

  await chooseSort(page, 'modified');
  await expect(groups(page)).toHaveCount(1);
  await page.locator('#searchInput input').fill('Milch');
  await expect(listItems(page)).toHaveCount(1);
  await expect(groups(page)).toHaveCount(0);
  await page.locator('#searchInput input').fill('');
  await expect(groups(page)).toHaveCount(1);
});

test('pin and unpin from the More actions menu', async ({ page }) => {
  await openApp(page);
  await pinFromEditorMenu(page, 'Sprint-Planung');
  const pinned = group(page, 'Angeheftet').locator('ui5-li');
  await expect(groups(page).first()).toHaveAttribute('header-text', 'Angeheftet');
  await expect(pinned).toHaveCount(1);
  await expect(pinned).toHaveAttribute('icon', 'pushpin-on');
  await expect(pinned).toHaveAttribute('accessible-name', /^Sprint-Planung, angeheftet\. /);
  await expect(pinned).toHaveAttribute('navigated', '');
  await expect(page.locator('#announcer')).toHaveText('„Sprint-Planung“ angeheftet.');

  // Pinned notes also come first when sorted by title, without a group header.
  await chooseSort(page, 'title');
  await expect(groups(page)).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual(['Sprint-Planung', 'Einkauf', 'Willkommen bei mdnotes']);
  await expect(listItems(page).first()).toHaveAttribute('icon', 'pushpin-on');

  await page.locator('#editorMoreButton').click();
  await expect(page.locator('#pinMenuItem')).toHaveAttribute('text', 'Loslösen');
  await expect(page.locator('#pinMenuItem')).toHaveAttribute('icon', 'pushpin-off');
  await page.locator('#pinMenuItem').click();
  await expect(page.locator('#announcer')).toHaveText('„Sprint-Planung“ losgelöst.');
  await expect.poll(() => titles(page)).toEqual(['Einkauf', 'Sprint-Planung', 'Willkommen bei mdnotes']);
  await expect(item(page, 'Sprint-Planung')).toHaveAttribute('icon', 'document-text');
});

test('pin from the list with Shift+F10, unpin with a right click; the focus stays on the note', async ({ page }) => {
  await openApp(page);
  const menu = page.locator('#noteContextMenu');
  // Clicking a note opens it and leaves the focus in the list.
  await item(page, 'Einkauf').click();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toHaveJSProperty('open', true);
  await expect(page.locator('#contextPinItem')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveJSProperty('open', false);
  const pinned = group(page, 'Angeheftet').locator('ui5-li');
  await expect(pinned).toContainText('Einkauf');
  await expect(pinned).toBeFocused();

  // Escape closes the menu without a change and gives the focus back.
  await page.keyboard.press('Shift+F10');
  await expect(menu).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveJSProperty('open', false);
  await expect(pinned).toBeFocused();
  await expect(pinned).toHaveCount(1);

  await pinned.click({ button: 'right' });
  await expect(menu).toHaveJSProperty('open', true);
  await expect(page.locator('#contextPinItem')).toHaveAttribute('text', 'Loslösen');
  await page.locator('#contextPinItem').click();
  await expect(group(page, 'Angeheftet')).toHaveCount(0);
  await expect(item(page, 'Einkauf')).toHaveAttribute('icon', 'document-text');
});

test('arrow keys move through notes and group headers, Enter opens a note', async ({ page }) => {
  await openApp(page);
  await chooseSort(page, 'created');
  await item(page, 'Willkommen').click();
  await expect.poll(() => isFocused(item(page, 'Willkommen'))).toBe(true);

  const target = item(page, 'Einkauf');
  const visited: string[] = [];
  for (let i = 0; i < 5 && !(await isFocused(target)); i++) {
    await page.keyboard.press('ArrowDown');
    visited.push(await page.evaluate(() => document.activeElement?.localName ?? ''));
  }
  await expect(target).toBeFocused();
  // The header "Gestern" lies between the two groups and can be reached, as UI5 intends.
  expect(visited).toContain('ui5-li-group');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toContainText('Milch');
});

test('label view is grouped as well', async ({ page }) => {
  await openApp(page);
  await chooseSort(page, 'created');
  await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
  await expect(listItems(page)).toHaveCount(1);
  await expect(groups(page)).toHaveCount(1);
  await expect(group(page, 'Heute').locator('ui5-li')).toContainText('Sprint-Planung');
});

test('trash: the pin is shown, but cannot be changed; restoring keeps it', async ({ page }) => {
  await openApp(page);
  await pinFromEditorMenu(page, 'Einkauf');
  await page.locator('#deleteButton').click();
  await page.locator('#trashItem').click();
  await expect(listItems(page)).toHaveCount(1);
  const entry = listItems(page).first();
  await expect(entry).toHaveAttribute('icon', 'pushpin-on');
  await expect(entry).toHaveAttribute('accessible-name', /^Einkauf, angeheftet\. /);
  await expect(page.locator('#sortButton')).toBeHidden();
  await expect(groups(page)).toHaveCount(0);

  await entry.click();
  await expect(page.locator('#trashActions')).toBeVisible();
  await page.keyboard.press('Shift+F10');
  await entry.click({ button: 'right' });
  await expect(page.locator('#noteContextMenu')).toHaveJSProperty('open', false);
  await expect(page.locator('#noteActions')).toBeHidden();

  await page.locator('#restoreButton').click();
  await page.locator('#allNotesItem').click();
  await expect(page.locator('#sortButton')).toBeVisible();
  await expect(group(page, 'Angeheftet').locator('ui5-li')).toContainText('Einkauf');
});

test('right to left: groups, pin and sort menu stay inside the column', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  await item(page, 'Sprint-Planung').click({ button: 'right' });
  await page.locator('#contextPinItem').click();
  await expect(group(page, 'Angeheftet')).toBeVisible();

  const column = (await page.locator('section[slot="midColumn"]').boundingBox())!;
  for (const locator of [group(page, 'Angeheftet'), group(page, 'Heute'), item(page, 'Sprint-Planung'), page.locator('#sortButton')]) {
    const box = (await locator.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
  }
  await chooseSort(page, 'title');
  await expect(groups(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

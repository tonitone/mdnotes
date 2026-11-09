import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The library column stays collapsed once the user collapsed it (issue #53). */

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const shellLink = (page: Page) => page.locator('#shell').getByRole('link', { name: 'mdnotes', exact: true });

async function openApp(page: Page) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#allNotesItem')).toBeVisible();
}

/**
 * Plays what UI5 does when the user collapses a column with the separator arrow:
 * the layout changes and the column layout fires `layout-change` with `resized: false`.
 */
async function setLayoutAsUser(page: Page, layout: string) {
  await page.locator('#fcl').evaluate(async (fcl, next) => {
    const element = fcl as HTMLElement & { layout: string };
    element.layout = next;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    element.dispatchEvent(
      new CustomEvent('layout-change', { detail: { layout: next, resized: false, separatorsUsed: true } }),
    );
  }, layout);
}

test('a collapsed library column stays hidden when a note is opened or the logo is clicked', async ({ page }) => {
  await openApp(page);
  await setLayoutAsUser(page, 'ThreeColumnsStartHiddenEndExpanded');
  await expect(page.locator('#allNotesItem')).toBeHidden();

  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#allNotesItem')).toBeHidden();

  await shellLink(page).click();
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#allNotesItem')).toBeHidden();

  // Resizing the window keeps the choice.
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(page.locator('#allNotesItem')).toBeHidden();
});

test('the library column stays open after the user opened it again', async ({ page }) => {
  await openApp(page);
  await setLayoutAsUser(page, 'ThreeColumnsStartHiddenEndExpanded');
  await expect(page.locator('#allNotesItem')).toBeHidden();

  await setLayoutAsUser(page, 'ThreeColumnsEndExpanded');
  await expect(page.locator('#allNotesItem')).toBeVisible();

  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#allNotesItem')).toBeVisible();
});

test('the library button reopens a collapsed column in a wide window', async ({ page }) => {
  await openApp(page);
  await setLayoutAsUser(page, 'ThreeColumnsStartHiddenEndExpanded');
  await expect(page.locator('#allNotesItem')).toBeHidden();

  await expect(page.locator('#libraryButton')).toBeVisible();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#allNotesItem')).toBeVisible();
  await expect(listItems(page).first()).toBeVisible();

  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('#allNotesItem')).toBeVisible();
});

test('a layout change caused by resizing does not reopen or collapse the library column', async ({ page }) => {
  await openApp(page);
  await setLayoutAsUser(page, 'ThreeColumnsStartHiddenEndExpanded');
  await expect(page.locator('#allNotesItem')).toBeHidden();

  // UI5 reports its own width-driven changes with `resized: true`; the app must not take them as a user choice.
  await page.locator('#fcl').evaluate(async (fcl) => {
    const element = fcl as HTMLElement & { layout: string };
    element.layout = 'ThreeColumnsEndExpanded';
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    element.dispatchEvent(
      new CustomEvent('layout-change', { detail: { layout: element.layout, resized: true, separatorsUsed: false } }),
    );
  });

  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#allNotesItem')).toBeHidden();
});

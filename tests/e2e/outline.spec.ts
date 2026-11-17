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
  const activeLine = () =>
    page.evaluate(() => {
      const v = (window as unknown as { __editorView: { state: { doc: { lineAt(p: number): { text: string } }; selection: { main: { head: number } } } } }).__editorView;
      return v.state.doc.lineAt(v.state.selection.main.head).text;
    });
  await expect.poll(activeLine).toBe('## Live Preview');
});

test('Esc closes the outline without moving the cursor', async ({ page }) => {
  await openWelcome(page);
  const head = () =>
    page.evaluate(() => (window as unknown as { __editorView: { state: { selection: { main: { head: number } } } } }).__editorView.state.selection.main.head);
  const before = await head();
  await openOutline(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await head()).toBe(before);
});

test('a note without headings shows an empty message', async ({ page }) => {
  await openWelcome(page);
  await page.evaluate(() => {
    const v = (window as unknown as { __editorView: { state: { doc: { length: number } }; dispatch(spec: unknown): void } }).__editorView;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'Nur Text' } });
  });
  await openOutline(page);
  await expect(dialog(page)).toContainText('Diese Notiz hat keine Überschriften.');
});

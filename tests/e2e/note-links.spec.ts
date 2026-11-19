import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorView: { state: { doc: { toString(): string } } } }).__editorView.state.doc.toString());

async function openNote(page: Page, title: string) {
  await listItems(page).filter({ hasText: title }).first().click();
  await expect(editor(page)).toBeVisible();
}

/** Opens "Sprint-Planung" and starts a link to "Willkommen" on a new last line. */
async function startLink(page: Page) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await openNote(page, 'Sprint-Planung');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[[Will');
  // Enter only accepts the suggestion once the list is open.
  await expect(page.locator('.cm-tooltip-autocomplete li')).toHaveCount(1);
}

test('[[ suggests notes and inserts a link bound to the note ID', async ({ page }) => {
  await startLink(page);
  const option = page.locator('.cm-tooltip-autocomplete li');
  await expect(option).toHaveCount(1);
  await expect(option).toContainText('Willkommen');
  await page.keyboard.press('Enter');
  expect(await editorDoc(page)).toMatch(/\[\[[0-9A-HJKMNP-TV-Z]{26}\|Willkommen[^\]]*\]\]$/);
});

test('a link shows the title, opens the target and the target lists the backlink', async ({ page }) => {
  await startLink(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  await page.keyboard.type(' danach');
  await expect(editor(page)).toContainText('danach');
  const link = page.locator('.cm-note-link');
  await expect(link).toHaveText(/Willkommen/);

  await link.click();
  await expect(page.locator('#backlinksRegion')).toBeVisible();
  await expect(page.locator('#backlinksList ui5-li')).toContainText('Sprint-Planung');

  // The backlink leads back to the note that holds the link.
  await page.locator('#backlinksList ui5-li').click();
  await expect(page.locator('#backlinksRegion')).toBeHidden();
  await expect(editor(page)).toContainText('danach');
});

test('Ctrl/Cmd+Enter opens the link at the cursor', async ({ page }) => {
  await startLink(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#backlinksList ui5-li')).toContainText('Sprint-Planung');
});

test('a note without incoming links shows no "Linked from" area', async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await openNote(page, 'Willkommen');
  await expect(page.locator('#backlinksRegion')).toBeHidden();
});

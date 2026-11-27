import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The folder tree in the library column (issue #86): it appears once a
 * subfolder holds a note, and choosing a folder lists the notes directly in it.
 * Browser mode adds nested notes through the mock adapter, as if another
 * program had created the files.
 */

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editor = (page: Page) => page.locator('.cm-content');
const section = (page: Page) => page.locator('#folderSection');
const folder = (page: Page, path: string) => page.locator(`#folderTree ui5-tree-item[data-folder="${path}"]`);

/**
 * Clicks a folder's own row. An expanded item's box also holds its children,
 * so the click goes to the top of the box, right of the expand arrow.
 */
async function choose(page: Page, path: string) {
  await folder(page, path).click({ position: { x: 150, y: 12 } });
}

async function addOutsideFile(page: Page, path: string, text: string) {
  await page.evaluate(
    ([p, t]) => (window as unknown as { __mdnotesExternalFile: (path: string, text: string) => Promise<void> }).__mdnotesExternalFile(p, t),
    [path, text],
  );
}

/** Three nested notes next to the three demo notes in the root. */
async function addNestedNotes(page: Page) {
  await addOutsideFile(page, 'projekte/plan.md', '# Projektplan\n\nMeilensteine');
  await addOutsideFile(page, 'projekte/2026/ziele.md', '# Quartalsziele\n\nZiele festhalten');
  await addOutsideFile(page, 'archiv/alt.md', '# Alte Notiz\n\nErledigt');
  await expect(folder(page, 'archiv')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
});

test('a flat workspace shows no folder section', async ({ page }) => {
  await expect(section(page)).toBeHidden();
  await expect(page.locator('#folderTree ui5-tree-item')).toHaveCount(0);
});

test('the tree shows the folders with their own note counts', async ({ page }) => {
  await addNestedNotes(page);
  await expect(section(page)).toBeVisible();
  // The root carries the workspace name and is expanded; deeper folders start collapsed.
  await expect(folder(page, '')).toHaveJSProperty('text', 'Demo-Workspace (Browser-Modus)');
  await expect(folder(page, '')).toHaveJSProperty('expanded', true);
  await expect(folder(page, '')).toHaveJSProperty('additionalText', '3');
  await expect(folder(page, 'projekte')).toHaveJSProperty('additionalText', '1');
  await expect(folder(page, 'projekte')).toHaveJSProperty('expanded', false);
  await expect(folder(page, 'projekte/2026')).toHaveJSProperty('additionalText', '1');
  // Sorted by name.
  const order = await page.locator('#folderTree ui5-tree-item[data-folder=""] > ui5-tree-item').evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).dataset.folder),
  );
  expect(order).toEqual(['archiv', 'projekte']);
});

test('choosing a folder lists only the notes directly in it, without the folder prefix', async ({ page }) => {
  await addNestedNotes(page);
  await choose(page, 'projekte');
  await expect(folder(page, 'projekte')).toHaveJSProperty('navigated', true);
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', false);
  await expect(page.locator('#notesTitle')).toHaveText('projekte');
  await expect(listItems(page)).toHaveCount(1);
  await expect(listItems(page).first()).toContainText('Projektplan');
  await expect(listItems(page).first()).toHaveAttribute('description', 'Meilensteine');

  // The root lists the root notes only.
  await choose(page, '');
  await expect(page.locator('#notesTitle')).toHaveText('Demo-Workspace (Browser-Modus)');
  await expect(listItems(page)).toHaveCount(3);
  await expect(listItems(page).filter({ hasText: 'Projektplan' })).toHaveCount(0);

  // "All notes" is still the recursive overview, with the prefix.
  await page.locator('#allNotesItem').click();
  await expect(listItems(page)).toHaveCount(6);
  await expect(listItems(page).filter({ hasText: 'Projektplan' })).toHaveAttribute('description', 'projekte · Meilensteine');
});

test('search applies to the chosen folder and keeps the prefix', async ({ page }) => {
  await addNestedNotes(page);
  await addOutsideFile(page, 'archiv/ziele-alt.md', '# Alte Ziele\n\nZiele von früher');
  await choose(page, 'archiv');
  await page.locator('#searchInput input').fill('Ziele');
  await expect(listItems(page)).toHaveCount(1);
  await expect(listItems(page).first()).toContainText('Alte Ziele');
  await expect(listItems(page).first()).toHaveAttribute('description', /^archiv · /);
});

test('keyboard: arrows move, Right expands, Enter chooses', async ({ page }) => {
  await addNestedNotes(page);
  await choose(page, 'archiv');
  await expect(page.locator('#notesTitle')).toHaveText('archiv');
  // Focus is still on "archiv"; the next item is "projekte".
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(folder(page, 'projekte')).toHaveJSProperty('expanded', true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#notesTitle')).toHaveText('2026');
  await expect(listItems(page)).toHaveCount(1);
  await expect(listItems(page).first()).toContainText('Quartalsziele');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(folder(page, 'projekte')).toHaveJSProperty('expanded', false);
});

test('the expanded state survives a change of the notes', async ({ page }) => {
  await addNestedNotes(page);
  await choose(page, 'projekte');
  await page.keyboard.press('ArrowRight');
  await expect(folder(page, 'projekte')).toHaveJSProperty('expanded', true);
  await addOutsideFile(page, 'projekte/2026/mehr.md', '# Mehr\n\nText');
  await expect(folder(page, 'projekte/2026')).toHaveJSProperty('additionalText', '2');
  await expect(folder(page, 'projekte')).toHaveJSProperty('expanded', true);
});

test('creating and trashing notes update the counts; an emptied folder falls back to all notes', async ({ page }) => {
  await addNestedNotes(page);
  await choose(page, '');
  // New notes are created in the root and the view switches to all notes.
  await page.locator('#newNoteButton').click();
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);
  await expect(folder(page, '')).toHaveJSProperty('additionalText', '4');

  await choose(page, 'archiv');
  await listItems(page).filter({ hasText: 'Alte Notiz' }).click();
  await expect(editor(page)).toContainText('Erledigt');
  await page.locator('#deleteButton').click();
  await expect(folder(page, 'archiv')).toHaveCount(0);
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);
  await expect(page.locator('#notesTitle')).toHaveText('Notizen');
});

test('the tree disappears when the last nested note is gone', async ({ page }) => {
  await addOutsideFile(page, 'archiv/alt.md', '# Alte Notiz\n\nErledigt');
  await expect(section(page)).toBeVisible();
  await listItems(page).filter({ hasText: 'Alte Notiz' }).click();
  await page.locator('#deleteButton').click();
  await expect(section(page)).toBeHidden();
});

test('narrow window: tree, list, editor and back', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await addNestedNotes(page);
  await page.locator('#libraryButton').click();
  await expect(folder(page, 'archiv')).toBeVisible();
  await choose(page, 'archiv');
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#notesTitle')).toHaveText('archiv');
  await listItems(page).first().click();
  await expect(editor(page)).toContainText('Erledigt');
  await page.locator('#backButton').click();
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#notesTitle')).toHaveText('archiv');
  await page.locator('#libraryButton').click();
  // The library comes back with the chosen folder still marked.
  await expect(folder(page, 'archiv')).toBeVisible();
  await expect(folder(page, 'archiv')).toHaveJSProperty('navigated', true);
});

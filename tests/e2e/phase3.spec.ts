import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorView: { state: { doc: { toString(): string } } } }).__editorView.state.doc.toString());

async function openApp(page: Page) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
}

async function openNote(page: Page, title: string) {
  await listItems(page).filter({ hasText: title }).first().click();
  await expect(editor(page)).toBeVisible();
}

test.describe('versions', () => {
  test('compare with an older version and restore it', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    const original = await editorDoc(page);

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    await expect(dialog.locator('ui5-li')).toHaveCount(2);
    await expect(dialog.locator('.versions-summary')).toContainText('1 Änderung');
    await expect(dialog.locator('.cm-mergeView')).toBeVisible();

    await dialog.locator('ui5-button', { hasText: 'Diese Version wiederherstellen' }).click();
    await expect(page.locator('ui5-dialog')).toHaveCount(0);
    expect(await editorDoc(page)).toBe(original);
    await expect(page.locator('#announcer')).toContainText('Version wiederhergestellt');

    await page.locator('#versionsButton').click();
    await expect(page.locator('ui5-dialog ui5-li')).toHaveCount(3);
  });
});

test.describe('labels', () => {
  test('rename a label in all notes', async ({ page }) => {
    await openApp(page);
    await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
    await page.locator('#renameLabelButton').click();
    const input = page.locator('ui5-dialog ui5-input input');
    await input.fill('Job');
    await input.press('Enter');
    await expect(page.locator('#notesTitle')).toHaveText('Label: Job');
    await expect(page.locator('#labelList ui5-li', { hasText: 'Job' })).toHaveCount(1);
    await expect(page.locator('#labelList ui5-li', { hasText: 'arbeit' })).toHaveCount(0);
    await expect(listItems(page)).toHaveCount(1);
  });
});

test.describe('backup', () => {
  test('back up, delete a note and restore it from the backup', async ({ page }) => {
    await openApp(page);
    await page.locator('#backupItem').click();
    const dialog = page.locator('ui5-dialog');
    await dialog.locator('ui5-button', { hasText: 'Jetzt sichern' }).click();
    await expect(dialog.locator('ui5-list ui5-li')).toHaveCount(1);
    await dialog.locator('ui5-button', { hasText: 'Schließen' }).click();
    await expect(page.locator('ui5-dialog')).toHaveCount(0);

    await openNote(page, 'Einkauf');
    await page.locator('#deleteButton').click();
    await expect(listItems(page)).toHaveCount(2);

    await page.locator('#backupItem').click();
    await page.locator('ui5-dialog ui5-list ui5-li').first().click();
    await page.locator('ui5-menu-item[text="Einzelne Notizen wiederherstellen …"]').click();
    const picker = page.locator('ui5-dialog', { has: page.locator('.backup-note-list') });
    await picker.locator('ui5-checkbox[data-path^="einkauf--"]').click();
    await picker.locator('ui5-button', { hasText: 'Wiederherstellen' }).click();
    await expect(page.locator('#announcer')).toContainText('1 importiert');
    await page.locator('ui5-dialog ui5-button', { hasText: 'Schließen' }).click();
    await expect(listItems(page)).toHaveCount(3);
  });
});

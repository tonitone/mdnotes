import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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

  test('take a single block from an older version with the keyboard', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    const original = await editorDoc(page);

    // Two changes far apart, so the diff shows two blocks.
    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await page.keyboard.type(' Q4');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    const changed = await editorDoc(page);
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    await expect(dialog.locator('.versions-summary')).toContainText('2 Änderungen');
    const take = dialog.locator('.versions-take[data-chunk="1"] ui5-button');
    await expect(take).toHaveJSProperty('accessibleName', 'Block 2 aus dieser Version übernehmen');
    await take.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.versions-summary')).toContainText('1 Änderung');
    await expect(dialog.locator('.versions-summary')).toContainText('noch nicht gespeichert');

    await dialog.locator('ui5-button', { hasText: 'Übernommene Blöcke speichern' }).click();
    await expect(page.locator('ui5-dialog')).toHaveCount(0);
    const restored = await editorDoc(page);
    expect(restored).not.toBe(changed);
    expect(restored).not.toBe(original);
    expect(restored).toContain('Q4');
    expect(restored).not.toContain('Neue Zeile');
    await expect(page.locator('#announcer')).toContainText('Blöcke übernommen');
  });

  test('reset taken blocks', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    const apply = dialog.locator('ui5-button', { hasText: 'Übernommene Blöcke speichern' });
    await expect(apply).toHaveJSProperty('disabled', true);
    await dialog.locator('.versions-take ui5-button').first().click();
    await expect(dialog.locator('.versions-summary')).toContainText('identisch');
    await expect(apply).toHaveJSProperty('disabled', false);

    await dialog.locator('ui5-button', { hasText: 'Zurücksetzen' }).click();
    await expect(dialog.locator('.versions-summary')).toContainText('1 Änderung');
    await expect(dialog.locator('.versions-summary')).not.toContainText('noch nicht gespeichert');
    await expect(apply).toHaveJSProperty('disabled', true);
  });

  test('a superseded version read does not replace the diff', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    const items = dialog.locator('ui5-li');
    const summary = dialog.locator('.versions-summary');
    const diff = dialog.locator('.versions-diff');
    // The older version is preselected; the newest one equals the current text.
    await expect(summary).toContainText('1 Änderung');
    const newest = (await items.nth(0).getAttribute('data-name'))!;
    const older = (await items.nth(1).getAttribute('data-name'))!;

    // The first read (older) finishes after the second one (newest).
    await page.evaluate(
      ([o, n]) => (window.__mdnotesVersionReadDelayMs = { [o]: 1500, [n]: 300 }),
      [older, newest],
    );
    await items.nth(1).click();
    await items.nth(0).click();
    // While the selected version loads, the old diff and its take buttons are out of reach.
    await expect(diff).toHaveAttribute('inert', '');
    await expect(dialog.locator('ui5-button', { hasText: 'Diese Version wiederherstellen' })).toHaveJSProperty('disabled', true);

    await expect(summary).toContainText('identisch');
    await expect(diff).not.toHaveAttribute('inert', '');
    await page.waitForTimeout(1700);
    await expect(summary).toContainText('identisch');
    await expect(dialog.locator('.versions-take')).toHaveCount(0);
    await expect(items.nth(0)).toHaveJSProperty('navigated', true);
    await expect(items.nth(1)).toHaveJSProperty('navigated', false);
  });

  test('the dialog stays open until taken blocks are saved', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    const original = await editorDoc(page);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    await dialog.locator('.versions-take ui5-button').first().click();
    await expect(dialog.locator('.versions-summary')).toContainText('identisch');

    await page.evaluate(() => (window.__mdnotesVersionWriteDelayMs = 1500));
    await dialog.locator('ui5-button', { hasText: 'Übernommene Blöcke speichern' }).click();
    // Every other action and closing wait for the pending write.
    await expect(dialog.locator('ui5-button', { hasText: 'Diese Version wiederherstellen' })).toHaveJSProperty('disabled', true);
    await expect(dialog.locator('ui5-button', { hasText: 'Schließen' })).toHaveJSProperty('disabled', true);
    await expect(dialog.locator('.versions-diff')).toHaveAttribute('inert', '');
    // Selecting another version waits too; the click also puts the focus into the dialog for Escape.
    await dialog.locator('ui5-li').nth(0).click();
    await expect(dialog.locator('ui5-li').nth(1)).toHaveJSProperty('navigated', true);
    await page.keyboard.press('Escape');
    await expect(page.locator('ui5-dialog')).toHaveCount(1);
    await expect(page.locator('ui5-dialog')).toHaveJSProperty('open', true);

    await expect(page.locator('ui5-dialog')).toHaveCount(0);
    expect(await editorDoc(page)).toBe(original);
    await expect(page.locator('#announcer')).toContainText('Blöcke übernommen');
  });

  test('a failed save stays visible and can be retried', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    const original = await editorDoc(page);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nNeue Zeile');
    await page.locator('#versionsButton').click();

    const dialog = page.locator('ui5-dialog');
    const summary = dialog.locator('.versions-summary');
    const apply = dialog.locator('ui5-button', { hasText: 'Übernommene Blöcke speichern' });
    const restore = dialog.locator('ui5-button', { hasText: 'Diese Version wiederherstellen' });
    await dialog.locator('.versions-take ui5-button').first().click();
    await expect(summary).toContainText('identisch');

    await page.evaluate(() => (window.__mdnotesVersionWriteFailures = 2));
    await apply.click();
    await expect(summary).toHaveText('Die übernommenen Blöcke konnten nicht gespeichert werden.');
    await expect(page.locator('ui5-dialog')).toHaveCount(1);
    await expect(apply).toHaveJSProperty('disabled', false);

    // The whole-version restore reports its failure the same way.
    await dialog.locator('ui5-button', { hasText: 'Zurücksetzen' }).click();
    await expect(restore).toHaveJSProperty('disabled', false);
    await restore.click();
    await expect(summary).toHaveText('Die Version konnte nicht wiederhergestellt werden.');
    await expect(restore).toHaveJSProperty('disabled', false);

    // Retry succeeds.
    await dialog.locator('.versions-take ui5-button').first().click();
    await apply.click();
    await expect(page.locator('ui5-dialog')).toHaveCount(0);
    expect(await editorDoc(page)).toBe(original);
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

  test('rename a label to a name over 40 characters keeps the label view', async ({ page }) => {
    await openApp(page);
    await page.locator('#labelList ui5-li', { hasText: 'arbeit' }).click();
    await page.locator('#renameLabelButton').click();
    const input = page.locator('ui5-dialog ui5-input input');
    await input.fill('x'.repeat(45));
    await input.press('Enter');
    const stored = 'x'.repeat(40);
    await expect(page.locator('#notesTitle')).toHaveText(`Label: ${stored}`);
    await expect(page.locator('#labelList ui5-li', { hasText: stored })).toHaveCount(1);
    await expect(page.locator('#renameLabelButton')).toBeVisible();
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
    const box = picker.locator('ui5-checkbox[data-path^="einkauf--"]');
    await expect(box).toHaveCount(1);
    await box.click();
    await expect(box).toHaveJSProperty('checked', true);
    await picker.locator('ui5-button', { hasText: 'Wiederherstellen' }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#announcer')).toContainText('1 importiert');
    await page.locator('ui5-dialog ui5-button', { hasText: 'Schließen' }).click();
    await expect(listItems(page)).toHaveCount(3);
  });
});

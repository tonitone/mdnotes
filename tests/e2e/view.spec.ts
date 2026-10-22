import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './axe';
import { expect, test } from './fixtures';

/** Tables in the live preview and the view modes edit, split and preview. */

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const preview = (page: Page) => page.locator('#previewPane');

async function openNote(page: Page, title: string) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: title }).first().click();
  await expect(editor(page)).toBeVisible();
}

async function chooseMode(page: Page, mode: 'edit' | 'split' | 'preview') {
  await page.locator(`#viewModeButton ui5-segmented-button-item[data-mode="${mode}"]`).click();
  await expect(page.locator('#editorArea')).toHaveAttribute('data-mode', mode);
}

test('a table is shown as a table until the cursor enters it', async ({ page }) => {
  await openNote(page, 'Sprint-Planung');
  const table = page.locator('.cm-md-table table');
  await expect(table).toBeVisible();
  await expect(table.locator('th')).toHaveText(['Thema', 'Status', 'Aufwand']);
  await expect(table.locator('td', { hasText: 'Tabellen in der Vorschau' })).toBeVisible();
  await expect(table.locator('th').nth(1)).toHaveClass('align-center');

  // Clicking the table reveals its Markdown for editing.
  await table.locator('td').first().click();
  await expect(page.locator('.cm-md-table')).toHaveCount(0);
  await expect(editor(page)).toContainText('| Thema | Status | Aufwand |');
});

test('a pasted table with emoji and parentheses renders', async ({ page }) => {
  await openNote(page, 'Einkauf');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(
    '\n| Suite | Status |\n|-------|--------|\n| PickerOptsHelperTest (PHP unit) | ✅ grün |\n| Karma JS (Media-Library-Suite, 116 Tests) | ✅ grün (11 UI5-Picker-Tests unverändert pending) |\n\nEnde',
  );
  const table = page.locator('.cm-md-table table');
  await expect(table.locator('td', { hasText: 'PickerOptsHelperTest (PHP unit)' })).toBeVisible();
  await expect(table.locator('td', { hasText: '✅ grün (11 UI5-Picker-Tests unverändert pending)' })).toBeVisible();
});

test('preview mode renders the note and hides the editor', async ({ page }) => {
  await openNote(page, 'Sprint-Planung');
  await chooseMode(page, 'preview');
  await expect(page.locator('#editor-host')).toBeHidden();
  await expect(preview(page).locator('h1')).toHaveText('Sprint-Planung');
  await expect(preview(page).locator('table th').first()).toHaveText('Thema');
  await expectNoSeriousViolations(page, 'preview');

  // The mode is remembered.
  await page.reload();
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: 'Einkauf' }).first().click();
  await expect(preview(page).locator('h1')).toHaveText('Einkauf');
});

test('split mode shows the source next to a live preview', async ({ page }) => {
  await openNote(page, 'Einkauf');
  await chooseMode(page, 'split');
  await expect(page.locator('#editor-host')).toBeVisible();
  await expect(preview(page)).toBeVisible();
  // Next to the preview the editor shows plain Markdown.
  await expect(editor(page)).toContainText('# Einkauf');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n## Neu im Split');
  await expect(preview(page).locator('h2')).toHaveText('Neu im Split');
  await expectNoSeriousViolations(page, 'split');

  await chooseMode(page, 'edit');
  await expect(preview(page)).toBeHidden();
});

test('a new note leaves preview mode', async ({ page }) => {
  await openNote(page, 'Einkauf');
  await chooseMode(page, 'preview');
  await page.locator('#newNoteButton').click();
  await expect(page.locator('#editorArea')).toHaveAttribute('data-mode', 'edit');
  await expect(editor(page)).toBeFocused();
});

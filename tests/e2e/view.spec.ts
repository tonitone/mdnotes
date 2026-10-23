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

test('split mode stacks by editor column width, not by window width', async ({ page }) => {
  const area = page.locator('#editorArea');
  const direction = () => area.evaluate((el) => getComputedStyle(el).flexDirection);
  const columnWidth = () => page.locator('.editor-column').evaluate((el) => el.getBoundingClientRect().width);

  // A 1200 px window is wider than 700 px, but with three columns the editor
  // column is narrower than that, so source and preview are stacked.
  await page.setViewportSize({ width: 1200, height: 900 });
  await openNote(page, 'Einkauf');
  await chooseMode(page, 'split');
  await expect.poll(columnWidth).toBeLessThanOrEqual(700);
  await expect.poll(direction).toBe('column');

  // A very wide window gives the column enough room for two panes side by side.
  await page.setViewportSize({ width: 2400, height: 900 });
  await expect.poll(columnWidth).toBeGreaterThan(700);
  await expect.poll(direction).toBe('row');
});

test('the column layout comes back when the window grows after "Zur Bibliothek"', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#allNotesItem')).toBeVisible();
  await expect(listItems(page).first()).toBeHidden();

  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#noSelection')).toBeVisible();
  await listItems(page).first().click();
  await expect(page.locator('#editorArea')).toBeVisible();
  await expect(listItems(page).first()).toBeVisible();
});

test('a narrow window without an open note shows the list', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#noSelection')).toBeHidden();

  // Shrinking from a wide window does the same.
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(page.locator('#noSelection')).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#noSelection')).toBeHidden();
});

const HEADER_IDS = ['viewModeButton', 'saveStatus', 'versionsButton', 'exportButton', 'deleteButton', 'editorMoreButton'];

for (const [name, width] of [
  ['very narrow', 320],
  ['narrow', 640],
  ['wide', 1920],
] as const) {
  test(`header with a ${name} editor column: no overlapping boxes, same names for the view buttons`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openNote(page, 'Sprint-Planung');
    const compact = name !== 'wide';
    const columnWidth = (await page.locator('#editorColumn').boundingBox())!.width;
    if (compact) expect(columnWidth).toBeLessThan(480);
    else expect(columnWidth).toBeGreaterThan(480);

    // The save status only has a box once it shows a text.
    await editor(page).click();
    await page.keyboard.type(' ');
    await expect(page.locator('#saveStatus')).toHaveText(/Gespeichert um/);

    // Icons only in a narrow column, text in a wide one; the names never change.
    const items = page.locator('#viewModeButton ui5-segmented-button-item');
    await expect(items.first()).toHaveJSProperty('accessibleName', 'Bearbeiten');
    await expect(items.nth(1)).toHaveJSProperty('accessibleName', 'Geteilt');
    await expect(items.nth(2)).toHaveJSProperty('accessibleName', 'Vorschau');
    await expect(items.first()).toHaveText(compact ? '' : 'Bearbeiten');
    await expect(items.first()).toHaveJSProperty('icon', compact ? 'edit' : '');

    // Every control must be there; a hidden one fails here instead of being skipped below.
    const ids = name === 'very narrow' ? ['backButton', ...HEADER_IDS] : HEADER_IDS;
    for (const id of ids) await expect(page.locator(`#${id}`), `${id} is visible`).toBeVisible();

    const boxes = await page.evaluate(
      (list) =>
        list.map((id) => {
          const rect = document.getElementById(id)!.getBoundingClientRect();
          return { id, width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }),
      ids,
    );
    for (const box of boxes) expect(box.width > 0 && box.height > 0, `${box.id} has a box`).toBe(true);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlaps = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }

    // The wrapping header must not widen the page (WCAG 1.4.10 reflow at 320 px).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
    for (const box of boxes) expect(box.right, `${box.id} stays inside the viewport`).toBeLessThanOrEqual(width + 0.5);
  });
}

for (const theme of ['light', 'hcb'] as const) {
  test(`compact header with icon-only view switch has no serious axe violations: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await page.setViewportSize({ width: 640, height: 800 });
    await openNote(page, 'Willkommen');
    const items = page.locator('#viewModeButton ui5-segmented-button-item');
    await expect(items.first()).toHaveText('');
    await expect(items.first()).toHaveJSProperty('icon', 'edit');
    await expectNoSeriousViolations(page, `compact header, ${theme}`);
  });
}

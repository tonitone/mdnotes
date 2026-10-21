import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousViolations } from './axe';

/**
 * Accessibility audit: axe (WCAG 2.2 AA) on every view, dialog and menu, in
 * all four themes and both languages, plus keyboard and reflow checks that
 * axe cannot do. The manual screen reader checklist is in docs/accessibility.md.
 */

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const dialog = (page: Page) => page.locator('ui5-dialog');

async function openApp(page: Page, url = '/') {
  await page.goto(url);
  await expect(listItems(page).first()).toBeVisible();
}

async function openNote(page: Page, title: string) {
  await listItems(page).filter({ hasText: title }).first().click();
  await expect(editor(page)).toBeVisible();
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Main views in every theme and language
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark', 'hcb', 'hcw'] as const) {
  test(`main view with a note open: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await openApp(page);
    await openNote(page, 'Willkommen');
    await expectNoSeriousViolations(page, theme);
  });
}

test('main view in English', async ({ page }) => {
  await openApp(page, '/?lang=en');
  await openNote(page, 'Willkommen');
  await expectNoSeriousViolations(page, 'en');
});

test('empty states: no note selected, no search results', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#noSelection')).toBeVisible();
  await expectNoSeriousViolations(page, 'no selection');
  await page.locator('#searchInput input').fill('zzzzzz');
  await expect(listItems(page)).toHaveCount(0);
  await expectNoSeriousViolations(page, 'no results');
});

test('label view and trash view with a read-only note', async ({ page }) => {
  await openApp(page);
  await page.locator('#labelList ui5-li').first().click();
  await expect(page.locator('#renameLabelButton')).toBeVisible();
  await expectNoSeriousViolations(page, 'label view');

  await page.locator('#allNotesItem').click();
  await openNote(page, 'Einkauf');
  await page.locator('#deleteButton').click();
  await page.locator('#trashItem').click();
  await listItems(page).first().click();
  await expect(page.locator('#trashActions')).toBeVisible();
  await expectNoSeriousViolations(page, 'trash');
});

test('notice strip after an outside change', async ({ page }) => {
  await openApp(page);
  await openNote(page, 'Einkauf');
  const id = await page.evaluate(() => document.querySelector<HTMLElement>('#notesList ui5-li[navigated]')?.dataset.id ?? '');
  await editor(page).click();
  await page.keyboard.type('x');
  await page.evaluate(
    ([noteId]) => (window as unknown as { __mdnotesExternalEdit: (id: string, body: string) => Promise<void> }).__mdnotesExternalEdit(noteId, '# Einkauf\n\nNeu\n'),
    [id],
  );
  await expect(page.locator('#noticeRegion ui5-button').first()).toBeVisible();
  await expectNoSeriousViolations(page, 'conflict notice');
});

// ---------------------------------------------------------------------------
// Menus and dialogs
// ---------------------------------------------------------------------------

test('menus: appearance, more actions, export', async ({ page }) => {
  await openApp(page);
  await page.locator('#themeItem').click();
  await expect(page.locator('#themeMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'appearance menu');
  await page.keyboard.press('Escape');

  await page.locator('#moreButton').click();
  await expect(page.locator('#moreMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'more menu');
  await page.keyboard.press('Escape');

  await openNote(page, 'Willkommen');
  await page.locator('#exportButton').click();
  await expect(page.locator('#exportMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'export menu');
});

test('versions dialog with a diff', async ({ page }) => {
  await openApp(page);
  await openNote(page, 'Sprint-Planung');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nNeue Zeile');
  await page.locator('#versionsButton').click();
  await expect(dialog(page).locator('.cm-mergeView')).toBeVisible();
  await expectNoSeriousViolations(page, 'versions');
  await closeDialog(page);
});

test('backup dialog, its actions menu and the note picker', async ({ page }) => {
  await openApp(page);
  await page.locator('#backupItem').click();
  await dialog(page).locator('ui5-button', { hasText: 'Jetzt sichern' }).click();
  await expect(dialog(page).locator('ui5-list ui5-li')).toHaveCount(1);
  await expectNoSeriousViolations(page, 'backup dialog');

  await dialog(page).locator('ui5-list ui5-li').click();
  await expectNoSeriousViolations(page, 'backup actions menu');
  await page.locator('ui5-menu-item[data-action="notes"]').click();
  await expect(dialog(page)).toHaveCount(2);
  await expectNoSeriousViolations(page, 'note picker');
});

test('confirm dialog for permanent deletion', async ({ page }) => {
  await openApp(page);
  await openNote(page, 'Einkauf');
  await page.locator('#deleteButton').click();
  await page.locator('#trashItem').click();
  await listItems(page).first().click();
  await page.locator('#deleteForeverButton').click();
  await expect(dialog(page)).toBeVisible();
  await expectNoSeriousViolations(page, 'confirm');
  await closeDialog(page);
});

test('prompt dialog for renaming a label', async ({ page }) => {
  await openApp(page);
  await page.locator('#labelList ui5-li').first().click();
  await page.locator('#renameLabelButton').click();
  await expect(dialog(page).locator('ui5-input')).toBeVisible();
  await expectNoSeriousViolations(page, 'prompt');
  await closeDialog(page);
});

// ---------------------------------------------------------------------------
// Keyboard, focus and reflow (not covered by axe)
// ---------------------------------------------------------------------------

test('the first Tab reaches the skip link, which moves focus into the content', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  // No note open: the note list is the content.
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('#notesList') !== null)).toBe(true);

  await openNote(page, 'Willkommen');
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
});

test('F6 moves between library, note list and editor', async ({ page }) => {
  await openApp(page);
  // Clicking the note leaves focus in the note list.
  await openNote(page, 'Willkommen');
  const area = () =>
    page.evaluate(() => {
      let node: Element | null = document.activeElement;
      // Follow focus into shadow roots and back to the light DOM host.
      while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
      const host = (n: Element | null): Element | null => (n ? n.closest('section[slot]') ?? host((n.getRootNode() as ShadowRoot).host ?? null) : null);
      return host(node)?.getAttribute('slot') ?? document.activeElement?.tagName;
    });
  expect(await area()).toBe('midColumn');
  await page.keyboard.press('F6');
  await expect.poll(area).toBe('endColumn');
  await page.keyboard.press('Shift+F6');
  await expect.poll(area).toBe('midColumn');

  // F6 cycles through every area, including the shell bar.
  const visited = new Set<string | undefined>();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('F6');
    await page.waitForTimeout(100);
    visited.add(await area());
  }
  expect([...visited]).toEqual(expect.arrayContaining(['startColumn', 'midColumn', 'endColumn']));
});

test('focus returns to the opener after closing a dialog', async ({ page }) => {
  await openApp(page);
  await openNote(page, 'Willkommen');
  await page.locator('#versionsButton').click();
  await expect(dialog(page)).toBeVisible();
  await closeDialog(page);
  await expect(page.locator('#versionsButton')).toBeFocused();
});

test('reflow: no horizontal scrolling at 320 CSS pixels (WCAG 1.4.10)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await openNote(page, 'Willkommen');
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Back to the list, then to the library, which is otherwise hidden in one column.
  await page.locator('#backButton').click();
  await expect(listItems(page).first()).toBeVisible();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#allNotesItem')).toBeVisible();
  await page.locator('#labelList ui5-li').first().click();
  await expect(listItems(page).first()).toBeVisible();
  await expectNoSeriousViolations(page, 'narrow');
});

test.describe('text spacing', () => {
  // The test injects a user style sheet, as a browser extension would; the app's CSP would block it.
  test.use({ bypassCSP: true });

  test('overrides do not cut off content (WCAG 1.4.12)', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Willkommen');
    await page.addStyleTag({
      content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    });
    await expect(editor(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

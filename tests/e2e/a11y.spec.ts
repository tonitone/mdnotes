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

// Code block tools (ui5-select and ui5-button at the fence line)
for (const theme of ['light', 'hcb'] as const) {
  test(`code block tools, cursor outside the fence: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await openApp(page);
    await openNote(page, 'Willkommen');
    await expect(page.locator('.cm-md-codetools')).toBeVisible();
    await expectNoSeriousViolations(page, `code tools ${theme}`);
  });

  test(`code block tools with the language list open: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await openApp(page);
    await openNote(page, 'Willkommen');
    await page.locator('.cm-md-codetools ui5-select').click();
    await expect(page.locator('.cm-md-codetools ui5-option[value="javascript"]')).toBeVisible();
    await expectNoSeriousViolations(page, `code tools list open ${theme}`);
  });
}

// A long note makes the editor scroll, in split mode in the stacked layout (scrollable-region-focusable)
for (const mode of ['edit', 'split'] as const) {
  test(`long note in ${mode} mode: the scrolling editor is keyboard reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await openApp(page);
    await openNote(page, 'Einkauf');
    await page.locator(`#viewModeButton ui5-segmented-button-item[data-mode="${mode}"]`).click();
    await expect(page.locator('#editorArea')).toHaveAttribute('data-mode', mode);
    if (mode === 'split') {
      await expect.poll(() => page.locator('#editorArea').evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column');
    }
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(Array.from({ length: 80 }, (_, i) => `\nZeile ${i + 1}`).join(''));
    const scroller = page.locator('.cm-scroller');
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expectNoSeriousViolations(page, `long note ${mode}`);

    // Back to the top; CodeMirror keeps a small scroll margin there, so the position is not exactly 0.
    const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
    await page.keyboard.press('Control+Home');
    await expect.poll(scrollTop).toBeLessThan(100);
    const top = await scrollTop();
    // Leave the editor (Esc, Shift+Tab); a single Tab brings focus back to the content, no extra stop.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    await expect(editor(page)).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(editor(page)).toBeFocused();
    // Page Down scrolls the region.
    await page.keyboard.press('PageDown');
    await expect.poll(scrollTop).toBeGreaterThan(top + 50);
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

// Note list with a pinned note and date groups (ui5-li-group), its sort menu and the context menu of a note
for (const theme of ['light', 'hcb'] as const) {
  test(`note list with groups, sort menu and note context menu: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await openApp(page);
    await listItems(page).filter({ hasText: 'Sprint-Planung' }).first().click({ button: 'right' });
    await expect(page.locator('#noteContextMenu')).toHaveJSProperty('open', true);
    await expectNoSeriousViolations(page, `note context menu ${theme}`);
    await page.locator('#contextPinItem').click();
    await expect(page.locator('#notesList ui5-li-group[header-text="Angeheftet"]')).toBeVisible();
    await expect(page.locator('#notesList ui5-li-group[header-text="Heute"]')).toBeVisible();
    await expectNoSeriousViolations(page, `groups ${theme}`);

    await page.locator('#sortButton').click();
    await expect(page.locator('#sortMenu')).toHaveJSProperty('open', true);
    await expectNoSeriousViolations(page, `sort menu ${theme}`);
    await page.locator('#sortMenu ui5-menu-item[data-sort="title"]').click();
    await expect(page.locator('#notesList ui5-li-group')).toHaveCount(0);
    await expectNoSeriousViolations(page, `title order with a pinned note ${theme}`);
  });
}

// ---------------------------------------------------------------------------
// Menus and dialogs
// ---------------------------------------------------------------------------

test('menus: appearance, language, more actions, export', async ({ page }) => {
  await openApp(page);
  await page.locator('#themeItem').click();
  await expect(page.locator('#themeMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'appearance menu');
  await page.keyboard.press('Escape');

  await page.locator('#languageItem').click();
  await expect(page.locator('#languageMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'language menu');
  await page.keyboard.press('Escape');

  await page.locator('#moreButton').click();
  await expect(page.locator('#moreMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'more menu');
  await page.keyboard.press('Escape');

  await openNote(page, 'Willkommen');
  await page.locator('#exportButton').click();
  await expect(page.locator('#exportMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'export menu');
  await page.keyboard.press('Escape');
  await expect(page.locator('#exportMenu')).toHaveJSProperty('open', false);

  await page.locator('#editorMoreButton').click();
  await expect(page.locator('#editorMoreMenu')).toHaveJSProperty('open', true);
  await expectNoSeriousViolations(page, 'editor more menu');
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

test('More actions menu: keyboard opens and copies, focus returns to the button', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page);
  await openNote(page, 'Sprint-Planung');
  const button = page.locator('#editorMoreButton');
  const menu = page.locator('#editorMoreMenu');

  // Open with Enter, close with Escape.
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveJSProperty('open', false);
  await expect(button).toBeFocused();

  // Open again and choose the first entry with the keyboard. The menu focuses its first
  // entry when it opens, so no arrow key is needed (one would move on to the next entry).
  await page.keyboard.press('Enter');
  await expect(menu).toHaveJSProperty('open', true);
  await expect(menu.locator('ui5-menu-item[data-action="copy-file-name"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveJSProperty('open', false);
  await expect(page.locator('#toast')).toHaveText('Dateiname kopiert.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^sprint-planung--[0-9a-z]{6}\.md$/);
  await expect(button).toBeFocused();
});

// ---------------------------------------------------------------------------
// Format toolbar and Format menu
// ---------------------------------------------------------------------------

for (const theme of ['light', 'hcb'] as const) {
  test(`format toolbar: theme ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await openApp(page);
    await openNote(page, 'Willkommen');
    await expect(page.locator('#formatToolbar')).toBeVisible();
    await expect(page.locator('#formatToolbar').getByRole('button', { name: 'Link', exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, `format toolbar ${theme}`);
  });
}

test('format toolbar at 320 CSS pixels: no horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await openNote(page, 'Willkommen');
  const toolbar = page.locator('#formatToolbar');
  await expect(toolbar).toBeVisible();
  const box = (await toolbar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, 'format toolbar 320');
});

test('More actions with the Format menu: axe with the menu and with the submenu open', async ({ page }) => {
  await openApp(page, '/?lang=en');
  await openNote(page, 'Willkommen');
  await page.locator('#editorMoreButton').click();
  await expect(page.locator('#editorMoreMenu')).toHaveJSProperty('open', true);
  await expect(page.locator('#formatMenuItem')).toBeVisible();
  await expectNoSeriousViolations(page, 'more actions menu');
  await page.locator('#formatMenuItem').click();
  await expect(page.locator('#formatMenuItem ui5-menu-item[data-format="bold"]')).toBeVisible();
  // One finding inside UI5 is listed in KNOWN_UI5_ISSUES (tests/e2e/axe.ts).
  await expectNoSeriousViolations(page, 'format submenu');
});

// ---------------------------------------------------------------------------
// Shell bar logo: carries the app name when the title is hidden (issue #38)
// ---------------------------------------------------------------------------

const shellLink = (page: Page) => page.locator('#shell').getByRole('link', { name: 'mdnotes', exact: true });
const shellTitle = (page: Page) => page.locator('#shell .ui5-shellbar-title');
const shellLogo = (page: Page) => page.locator('#shellLogo');

async function expectLogoLoaded(page: Page) {
  await expect(shellLogo(page)).toBeVisible();
  await expect
    .poll(() => shellLogo(page).evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)))
    .toBeGreaterThan(0);
}

for (const theme of ['light', 'hcb'] as const) {
  for (const [name, width] of [
    ['narrow', 500],
    ['wide', 1400],
  ] as const) {
    test(`shell bar logo in a ${name} window: theme ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('mdnotes.theme', value), theme);
      await page.setViewportSize({ width, height: 800 });
      await openApp(page);
      await expectLogoLoaded(page);
      // One link named "mdnotes"; the image itself is decorative, so the name is not read twice.
      await expect(shellLink(page)).toHaveCount(1);
      await expect(shellLink(page)).toBeVisible();
      await expect(shellLogo(page)).toHaveAttribute('alt', '');
      if (name === 'narrow') {
        // At size S UI5 drops the title and keeps the logo.
        await expect(shellTitle(page)).toHaveCount(0);
      } else {
        await expect(shellTitle(page)).toBeVisible();
        await expect(shellTitle(page)).toHaveText('mdnotes');
      }
      await expectNoSeriousViolations(page, `shell bar logo ${name} ${theme}`);
    });
  }
}

test('shell bar logo: each theme family has its own file', async ({ page }) => {
  const sources = new Set<string | null>();
  await page.goto('/');
  for (const theme of ['light', 'dark', 'hcb', 'hcw']) {
    await page.evaluate((value) => localStorage.setItem('mdnotes.theme', value), theme);
    await page.reload();
    // The theme is applied once the language is loaded; only then the logo gets its file.
    await expect(page.locator('html')).toHaveAttribute('data-theme', `sap_horizon${theme === 'light' ? '' : `_${theme}`}`);
    await expectLogoLoaded(page);
    sources.add(await shellLogo(page).getAttribute('src'));
  }
  expect(sources.size).toBe(4);
});

test('shell bar logo leads back to all notes, by mouse and keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openApp(page);
  await openNote(page, 'Willkommen');
  await expect(editor(page)).toContainText('Willkommen');

  // Wide window: the list switches to all notes and gets the focus, the open note stays (issue #54).
  await shellLink(page).click();
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText('Willkommen');
  await expect(page.locator('#noSelection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('#notesList') !== null)).toBe(true);

  // From a label view with Enter: back to all notes, the note stays open.
  await page.locator('#labelList ui5-li').first().click();
  await expect(page.locator('#notesTitle')).not.toHaveText('Notizen');
  await shellLink(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#notesTitle')).toHaveText('Notizen');
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);

  // With no note open the editor column shows its empty state, as before.
  await page.locator('#labelList ui5-li').first().click();
  await shellLink(page).click();
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);
  await expect(listItems(page).first()).toBeVisible();

  // A trash entry is not part of all notes: it is closed.
  await openNote(page, 'Einkauf');
  await page.locator('#deleteButton').click();
  await page.locator('#trashItem').click();
  await listItems(page).first().click();
  await expect(page.locator('#deleteForeverButton')).toBeVisible();
  await shellLink(page).click();
  await expect(page.locator('#noSelection')).toBeVisible();
  await expect(page.locator('#allNotesItem')).toHaveJSProperty('navigated', true);

  // In a narrow window with Space: the list replaces the editor, the note stays open behind it.
  await page.setViewportSize({ width: 500, height: 800 });
  await openNote(page, 'Willkommen');
  await expect(listItems(page).first()).toBeHidden();
  await shellLink(page).focus();
  await page.keyboard.press('Space');
  await expect(listItems(page).first()).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText('Willkommen');
});

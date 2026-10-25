import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './axe';
import { expect, test } from './fixtures';

/** Format shortcuts (Mod+B, I, K, Shift+X), the format toolbar and the Format menu. */

interface TestView {
  state: { doc: { toString(): string }; selection: { main: { from: number; to: number; head: number } } };
  dispatch(spec: unknown): void;
  focus(): void;
}

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const toolbar = (page: Page) => page.locator('#formatToolbar');
const toolbarButton = (page: Page, name: string) => toolbar(page).getByRole('button', { name, exact: true });
const toolbarItem = (page: Page, format: string) => page.locator(`#formatToolbar ui5-toolbar-button[data-format="${format}"]`);
const overflowButton = (page: Page) => toolbar(page).locator('.ui5-tb-overflow-btn');

async function openNote(page: Page, url = '/') {
  await page.goto(url);
  await expect(listItems(page).first()).toBeVisible();
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
}

/** Replaces the whole text and selects `from` to `to` (a caret when `to` is left out). */
async function setText(page: Page, text: string, from: number, to = from) {
  await page.evaluate(
    ({ text, from, to }) => {
      const v = (window as unknown as { __editorView: TestView }).__editorView;
      v.dispatch({ changes: { from: 0, to: v.state.doc.toString().length, insert: text }, selection: { anchor: from, head: to } });
      v.focus();
    },
    { text, from, to },
  );
  await expect(editor(page)).toBeFocused();
}

const docText = (page: Page) => page.evaluate(() => (window as unknown as { __editorView: TestView }).__editorView.state.doc.toString());
const selectedText = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as { __editorView: TestView }).__editorView;
    const { from, to } = v.state.selection.main;
    return v.state.doc.toString().slice(from, to);
  });
const caret = (page: Page) => page.evaluate(() => (window as unknown as { __editorView: TestView }).__editorView.state.selection.main.head);

/** Text of the note used below: the word "Welt" sits at 13 to 17. */
const TEXT = 'Titel\n\nHallo Welt';
const WELT = [13, 17] as const;

test.describe('shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await openNote(page);
  });

  test('Mod+B wraps the selection in bold and a second press removes it', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe('Titel\n\nHallo **Welt**');
    expect(await selectedText(page)).toBe('Welt');
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe(TEXT);
    expect(await selectedText(page)).toBe('Welt');
  });

  test('Mod+I wraps in italic and does not select the parent syntax node', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+i');
    expect(await docText(page)).toBe('Titel\n\nHallo *Welt*');
    expect(await selectedText(page)).toBe('Welt');
    await page.keyboard.press('ControlOrMeta+i');
    expect(await docText(page)).toBe(TEXT);
  });

  test('italic on bold text adds a third asterisk and removes only the italic part', async ({ page }) => {
    await setText(page, 'Titel\n\nHallo **Welt**', 15, 19);
    await page.keyboard.press('ControlOrMeta+i');
    expect(await docText(page)).toBe('Titel\n\nHallo ***Welt***');
    await page.keyboard.press('ControlOrMeta+i');
    expect(await docText(page)).toBe('Titel\n\nHallo **Welt**');
  });

  test('Mod+Shift+X toggles strikethrough', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+Shift+x');
    expect(await docText(page)).toBe('Titel\n\nHallo ~~Welt~~');
    await page.keyboard.press('ControlOrMeta+Shift+x');
    expect(await docText(page)).toBe(TEXT);
  });

  test('without a selection the word at the caret is wrapped and the caret stays in it', async ({ page }) => {
    await setText(page, TEXT, 15);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe('Titel\n\nHallo **Welt**');
    expect(await caret(page)).toBe(17);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe(TEXT);
    expect(await caret(page)).toBe(15);
  });

  test('on an empty line it inserts a pair with the caret inside, and typing fills it', async ({ page }) => {
    await setText(page, 'Titel\n\n', 7);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe('Titel\n\n****');
    expect(await caret(page)).toBe(9);
    await page.keyboard.type('fett');
    expect(await docText(page)).toBe('Titel\n\n**fett**');
    // An empty pair is removed again.
    await setText(page, 'Titel\n\n****', 9);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe('Titel\n\n');
  });

  test('Mod+K links the selection and selects the url, so typing replaces it', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+k');
    expect(await docText(page)).toBe('Titel\n\nHallo [Welt](url)');
    expect(await selectedText(page)).toBe('url');
    await page.keyboard.type('https://example.org');
    expect(await docText(page)).toBe('Titel\n\nHallo [Welt](https://example.org)');
  });

  test('Mod+K inside a link removes the link and keeps the text', async ({ page }) => {
    await setText(page, 'Titel\n\nHallo [Welt](https://example.org)', 16);
    await page.keyboard.press('ControlOrMeta+k');
    expect(await docText(page)).toBe(TEXT);
  });

  test('the shortcuts work in split view, where the editor shows plain source', async ({ page }) => {
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="split"]').click();
    await expect(page.locator('#editorArea')).toHaveAttribute('data-mode', 'split');
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await docText(page)).toBe('Titel\n\nHallo **Welt**');
    await expect(page.locator('#previewPane strong')).toHaveText('Welt');
  });

  test('a format is announced in the live region without a toast', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.locator('#announcer')).toHaveText('Fett an');
    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.locator('#announcer')).toHaveText('Fett aus');
    await expect(page.locator('#toast')).toHaveJSProperty('open', false);
  });
});

test('the toolbar is hidden while no note is open', async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('#noSelection')).toBeVisible();
  await expect(toolbar(page)).toBeHidden();
});

test.describe('toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await openNote(page);
  });

  test('is shown for a note, in edit and split view, and hidden in the preview', async ({ page }) => {
    await expect(toolbar(page)).toBeVisible();
    for (const name of ['Überschrift', 'Liste', 'Aufgabe', 'Tabelle', 'Code', 'Link']) {
      await expect(toolbarButton(page, name), name).toBeVisible();
    }
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="split"]').click();
    await expect(toolbar(page)).toBeVisible();
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="preview"]').click();
    await expect(toolbar(page)).toBeHidden();
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="edit"]').click();
    await expect(toolbar(page)).toBeVisible();
  });

  test('is hidden for a trashed (read-only) note', async ({ page }) => {
    await page.locator('#allNotesItem').click();
    await listItems(page).filter({ hasText: 'Einkauf' }).first().click();
    await expect(toolbar(page)).toBeVisible();
    await page.locator('#deleteButton').click();
    await page.locator('#trashItem').click();
    await listItems(page).first().click();
    await expect(page.locator('#trashActions')).toBeVisible();
    await expect(toolbar(page)).toBeHidden();
  });

  test('the link tooltip names the shortcut', async ({ page }) => {
    await expect(toolbarItem(page, 'link')).toHaveAttribute('tooltip', 'Link (Strg+K)');
  });

  test('the link button wraps the selection, selects the url and returns the focus to the editor', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await toolbarButton(page, 'Link').click();
    expect(await docText(page)).toBe('Titel\n\nHallo [Welt](url)');
    expect(await selectedText(page)).toBe('url');
    await expect(editor(page)).toBeFocused();
  });

  test('the heading button cycles through levels 1 to 3 and off', async ({ page }) => {
    await setText(page, TEXT, 15);
    const levels = ['# Hallo Welt', '## Hallo Welt', '### Hallo Welt', 'Hallo Welt'];
    for (const line of levels) {
      await toolbarButton(page, 'Überschrift').click();
      expect(await docText(page)).toBe(`Titel\n\n${line}`);
      await expect(editor(page)).toBeFocused();
    }
    await expect(page.locator('#announcer')).toHaveText('Überschrift aus');
  });

  test('list and task buttons toggle markers on every selected line', async ({ page }) => {
    await setText(page, 'Titel\n\neins\nzwei', 7, 16);
    await toolbarButton(page, 'Liste').click();
    expect(await docText(page)).toBe('Titel\n\n- eins\n- zwei');
    await toolbarButton(page, 'Aufgabe').click();
    expect(await docText(page)).toBe('Titel\n\n- [ ] eins\n- [ ] zwei');
    await toolbarButton(page, 'Aufgabe').click();
    expect(await docText(page)).toBe('Titel\n\neins\nzwei');
  });

  test('the table button inserts a table and selects the first header cell', async ({ page }) => {
    await setText(page, 'Titel\n\nText', 11);
    await toolbarButton(page, 'Tabelle').click();
    expect(await docText(page)).toBe('Titel\n\nText\n\n| Spalte 1 | Spalte 2 |\n| --- | --- |\n|  |  |');
    expect(await selectedText(page)).toBe('Spalte 1');
    await expect(editor(page)).toBeFocused();
  });

  test('the code button makes inline code for a word and a fenced block for several lines', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await toolbarButton(page, 'Code').click();
    expect(await docText(page)).toBe('Titel\n\nHallo `Welt`');
    await setText(page, 'Titel\n\neins\nzwei', 7, 16);
    await toolbarButton(page, 'Code').click();
    expect(await docText(page)).toBe('Titel\n\n```\neins\nzwei\n```');
  });

  test('is operated with the keyboard: Esc, Shift+Tab reaches it, Enter runs the action', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    await expect(toolbarItem(page, 'link')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await docText(page)).toBe('Titel\n\nHallo [Welt](url)');
    await expect(editor(page)).toBeFocused();
  });

  test('arrow keys, Home and End move between the buttons; Space runs the action', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    await expect(toolbarItem(page, 'link')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(toolbarItem(page, 'code')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(toolbarItem(page, 'heading')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbarItem(page, 'list')).toBeFocused();
    await page.keyboard.press('End');
    await expect(toolbarItem(page, 'link')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(toolbarItem(page, 'heading')).toBeFocused();
    // Tab leaves the toolbar backwards and comes back in on the same button.
    await page.keyboard.press('Shift+Tab');
    await expect(toolbarItem(page, 'heading')).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toolbarItem(page, 'heading')).toBeFocused();
    await page.keyboard.press('Space');
    expect(await docText(page)).toBe('Titel\n\n# Hallo Welt');
    await expect(editor(page)).toBeFocused();
  });

  for (const density of ['compact', 'cozy'] as const) {
    test(`every button is at least 24 x 24 px: density ${density}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('mdnotes.density', value), density);
      await openNote(page);
      const buttons = toolbar(page).getByRole('button');
      await expect(buttons).toHaveCount(6);
      for (const [i, box] of (await buttons.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))).entries()) {
        expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(24);
        expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(24);
      }
    });
  }
});

/** Formats whose toolbar button sits in the overflow menu. */
const overflowedFormats = (page: Page) =>
  page.locator('#formatToolbar ui5-toolbar-button').evaluateAll((nodes) =>
    nodes.filter((n) => (n as HTMLElement & { isOverflowed: boolean }).isOverflowed).map((n) => (n as HTMLElement).dataset.format),
  );

/** Asserts that all six buttons sit in the toolbar row and the overflow button is hidden. */
async function expectAllButtonsInRow(page: Page) {
  await expect(overflowButton(page)).toBeHidden();
  await expect.poll(() => overflowedFormats(page)).toEqual([]);
  const bar = (await toolbar(page).boundingBox())!;
  const buttons = toolbar(page).getByRole('button');
  await expect(buttons).toHaveCount(6);
  for (const [i, box] of (await buttons.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))).entries()) {
    expect(box.width, `button ${i} width`).toBeGreaterThan(0);
    expect(box.left, `button ${i} left`).toBeGreaterThanOrEqual(bar.x - 0.5);
    expect(box.right, `button ${i} right`).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
    expect(box.top, `button ${i} top`).toBeGreaterThanOrEqual(bar.y - 0.5);
    expect(box.bottom, `button ${i} bottom`).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
  }
}

test.describe('toolbar overflow', () => {
  test('at normal width every button is in the row, also after the toolbar was hidden and shown again', async ({ page }) => {
    // The toolbar starts hidden (no note open) and is measured only once it gets a width.
    await openNote(page);
    await expectAllButtonsInRow(page);
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="preview"]').click();
    await expect(toolbar(page)).toBeHidden();
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="edit"]').click();
    await expect(toolbar(page)).toBeVisible();
    await expectAllButtonsInRow(page);
  });

  test('at 320 CSS pixels: no horizontal scrolling, every button is in the row or in the overflow menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openNote(page);
    await expect(toolbar(page)).toBeVisible();
    const bar = (await toolbar(page).boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(320.5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const overflowed = await overflowedFormats(page);
    if (overflowed.length === 0) await expectAllButtonsInRow(page);
    else await expect(overflowButton(page)).toBeVisible();
  });

  test.describe('in a very narrow window', () => {
    test.beforeEach(async ({ page }) => {
      // Narrower than 320 px so that the six buttons cannot fit in either density.
      await page.setViewportSize({ width: 200, height: 640 });
      await openNote(page);
      await expect(toolbar(page)).toBeVisible();
      await expect(overflowButton(page)).toBeVisible();
      await expect.poll(async () => (await overflowedFormats(page)).length).toBeGreaterThan(0);
    });

    test('the last buttons move into the overflow menu and work from there with the mouse', async ({ page }) => {
      const overflowed = await overflowedFormats(page);
      // UI5 moves items out from the end of the row.
      expect(overflowed.at(-1)).toBe('link');
      await setText(page, TEXT, ...WELT);
      await overflowButton(page).click();
      const link = toolbarItem(page, 'link');
      await expect(link).toBeVisible();
      await link.click();
      expect(await docText(page)).toBe('Titel\n\nHallo [Welt](url)');
      expect(await selectedText(page)).toBe('url');
      await expect(link).toBeHidden();
      await expect(editor(page)).toBeFocused();
    });

    test('the overflow menu is operated with the keyboard', async ({ page }) => {
      const first = (await overflowedFormats(page))[0]!;
      await setText(page, TEXT, ...WELT);
      await page.keyboard.press('Escape');
      // The overflow button is the last stop of the toolbar.
      await page.keyboard.press('Shift+Tab');
      await expect(overflowButton(page)).toBeFocused();
      await page.keyboard.press('Enter');
      // Opening moves the focus to the first item in the menu.
      await expect(toolbarItem(page, first)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toolbarItem(page, first)).toBeHidden();
      await expect(overflowButton(page)).toBeFocused();
      // Open again and run the item with Enter.
      await page.keyboard.press('Enter');
      await expect(toolbarItem(page, first)).toBeFocused();
      const before = await docText(page);
      await page.keyboard.press('Enter');
      await expect(toolbarItem(page, first)).toBeHidden();
      await expect(editor(page)).toBeFocused();
      expect(await docText(page)).not.toBe(before);
    });

    test('axe with the overflow menu open', async ({ page }) => {
      await overflowButton(page).click();
      await expect(toolbarItem(page, 'link')).toBeVisible();
      await expectNoSeriousViolations(page, 'toolbar overflow open');
    });
  });
});

test('English: names and the shortcut in the tooltip follow the language', async ({ page }) => {
  await openNote(page, '/?lang=en');
  // The note is called "Willkommen" in every language, the UI around it is English.
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await expect(toolbarButton(page, 'Heading')).toBeVisible();
  await expect(toolbarItem(page, 'link')).toHaveAttribute('tooltip', 'Link (Ctrl+K)');
  await setText(page, TEXT, ...WELT);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.locator('#announcer')).toHaveText('Bold on');
});

test.describe('Format menu in More actions', () => {
  const menu = (page: Page) => page.locator('#editorMoreMenu');
  const item = (page: Page, format: string) => page.locator(`#formatMenuItem ui5-menu-item[data-format="${format}"]`);

  test.beforeEach(async ({ page }) => {
    await openNote(page);
  });

  test('applies bold with the mouse and returns the focus to the editor', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.locator('#editorMoreButton').click();
    await expect(menu(page)).toHaveJSProperty('open', true);
    await page.locator('#formatMenuItem').click();
    await expect(item(page, 'bold')).toBeVisible();
    await item(page, 'bold').click();
    await expect(menu(page)).toHaveJSProperty('open', false);
    await expect(editor(page)).toBeFocused();
    expect(await docText(page)).toBe('Titel\n\nHallo **Welt**');
  });

  test('names the shortcuts', async ({ page }) => {
    await expect(item(page, 'bold')).toHaveJSProperty('additionalText', 'Strg+B');
    await expect(item(page, 'italic')).toHaveJSProperty('additionalText', 'Strg+I');
    await expect(item(page, 'strike')).toHaveJSProperty('additionalText', 'Strg+Umschalt+X');
    await expect(item(page, 'strike')).toHaveJSProperty('accessibilityAttributes', { ariaKeyShortcuts: 'Control+Shift+X' });
  });

  test('is operated with the keyboard', async ({ page }) => {
    await setText(page, TEXT, ...WELT);
    await page.locator('#editorMoreButton').focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveJSProperty('open', true);
    // The menu focuses its first entry ("Copy file name"); "Format" is the second.
    await expect(page.locator('#editorMoreMenu ui5-menu-item[data-action="copy-file-name"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#formatMenuItem')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'bold')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'italic')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveJSProperty('open', false);
    await expect(editor(page)).toBeFocused();
    expect(await docText(page)).toBe('Titel\n\nHallo *Welt*');
  });

  test('is disabled in the preview', async ({ page }) => {
    await expect(page.locator('#formatMenuItem')).toHaveJSProperty('disabled', false);
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="preview"]').click();
    await expect(page.locator('#formatMenuItem')).toHaveJSProperty('disabled', true);
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="edit"]').click();
    await expect(page.locator('#formatMenuItem')).toHaveJSProperty('disabled', false);
  });
});

test('axe: toolbar with a selection that the actions changed', async ({ page }) => {
  await openNote(page);
  await setText(page, TEXT, ...WELT);
  await toolbarButton(page, 'Tabelle').click();
  await expectNoSeriousViolations(page, 'toolbar after an action');
});

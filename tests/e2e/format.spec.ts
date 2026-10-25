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
    await expect(page.locator('#formatToolbar ui5-button[data-format="link"]')).toHaveAttribute('tooltip', 'Link (Strg+K)');
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
    await expect(page.locator('#formatToolbar ui5-button[data-format="link"]')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await docText(page)).toBe('Titel\n\nHallo [Welt](url)');
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

test('English: names and the shortcut in the tooltip follow the language', async ({ page }) => {
  await openNote(page, '/?lang=en');
  // The note is called "Willkommen" in every language, the UI around it is English.
  await expect(toolbar(page)).toHaveAttribute('aria-label', 'Formatting');
  await expect(toolbarButton(page, 'Heading')).toBeVisible();
  await expect(page.locator('#formatToolbar ui5-button[data-format="link"]')).toHaveAttribute('tooltip', 'Link (Ctrl+K)');
  await setText(page, TEXT, ...WELT);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.locator('#announcer')).toHaveText('Bold on');
});

test('axe: toolbar with a selection that the actions changed', async ({ page }) => {
  await openNote(page);
  await setText(page, TEXT, ...WELT);
  await toolbarButton(page, 'Tabelle').click();
  await expectNoSeriousViolations(page, 'toolbar after an action');
});

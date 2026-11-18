import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Table editing: Tab and Shift+Tab move between cells, Enter adds a row, pipes are aligned. */

interface TestView {
  state: { doc: { toString(): string; sliceString(from: number, to: number): string }; selection: { main: { from: number; to: number } } };
  dispatch(spec: unknown): void;
  focus(): void;
}

const editor = (page: Page) => page.locator('.cm-content');

async function openNote(page: Page) {
  await page.goto('/');
  const items = page.locator('#notesList ui5-li');
  await expect(items.first()).toBeVisible();
  await items.filter({ hasText: 'Willkommen' }).first().click();
  await expect(editor(page)).toBeVisible();
}

async function setText(page: Page, text: string, caret: number) {
  await page.evaluate(
    ({ text, caret }) => {
      const v = (window as unknown as { __editorView: TestView }).__editorView;
      v.dispatch({ changes: { from: 0, to: v.state.doc.toString().length, insert: text }, selection: { anchor: caret } });
      v.focus();
    },
    { text, caret },
  );
  await expect(editor(page)).toBeFocused();
}

const docText = (page: Page) => page.evaluate(() => (window as unknown as { __editorView: TestView }).__editorView.state.doc.toString());
const selectedText = (page: Page) =>
  page.evaluate(() => {
    const { state } = (window as unknown as { __editorView: TestView }).__editorView;
    const { from, to } = state.selection.main;
    return state.doc.sliceString(from, to);
  });

const TABLE = 'Titel\n\n| Name | Alter |\n| --- | --- |\n| Alexander | 7 |';
// A caret in the header cell "Name".
const IN_NAME = TABLE.indexOf('Name') + 1;

test.describe('table editing', () => {
  test.beforeEach(async ({ page }) => {
    await openNote(page);
  });

  test('Tab aligns the pipes and selects the next cell', async ({ page }) => {
    await setText(page, TABLE, IN_NAME);
    await page.keyboard.press('Tab');
    expect(await docText(page)).toBe('Titel\n\n| Name      | Alter |\n| --------- | ----- |\n| Alexander | 7     |');
    expect(await selectedText(page)).toBe('Alter');
  });

  test('Tab in the last cell adds a row and Shift+Tab goes back', async ({ page }) => {
    await setText(page, TABLE, TABLE.length - 2);
    await page.keyboard.press('Tab');
    const lines = (await docText(page)).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('|           |       |');
    await page.keyboard.press('Shift+Tab');
    expect(await selectedText(page)).toBe('7');
  });

  test('Enter adds a row below and puts the caret in its first cell', async ({ page }) => {
    await setText(page, TABLE, TABLE.length - 2);
    await page.keyboard.press('Enter');
    await page.keyboard.type('x');
    expect((await docText(page)).split('\n')[5]).toContain('x');
    expect((await docText(page)).split('\n')).toHaveLength(6);
  });

  test('Tab outside a table still indents', async ({ page }) => {
    await setText(page, 'Titel\n\n- eins', 13);
    await page.keyboard.press('Tab');
    expect(await docText(page)).toBe('Titel\n\n  - eins');
  });

  test('Esc, then Tab leaves the editor even inside a table', async ({ page }) => {
    await setText(page, TABLE, IN_NAME);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(editor(page)).not.toBeFocused();
    expect(await docText(page)).toBe(TABLE);
  });
});

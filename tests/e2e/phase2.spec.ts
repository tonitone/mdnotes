import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorView: { state: { doc: { toString(): string } } } }).__editorView.state.doc.toString());

/** 1×1 red PNG. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
}

async function openNote(page: Page, title: string) {
  await listItems(page).filter({ hasText: title }).first().click();
  await expect(editor(page)).toBeVisible();
}

async function noteId(page: Page, title: string): Promise<string> {
  return page.evaluate((t) => {
    const item = [...document.querySelectorAll<HTMLElement>('#notesList ui5-li')].find((li) => li.textContent?.includes(t));
    return item?.dataset.id ?? '';
  }, title);
}

async function menuItem(page: Page, menu: string, text: string) {
  await page.locator(`#${menu} ui5-menu-item[text="${text}"]`).click();
}

test.describe('labels', () => {
  test('add a label, filter by it and remove it again', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Sprint-Planung');
    await expect(page.locator('#labelInput ui5-token')).toHaveCount(1); // "arbeit" from the demo

    const input = page.locator('#labelInput input');
    await input.fill('projekt');
    await input.press('Enter');
    await expect(page.locator('#labelInput ui5-token')).toHaveCount(2);

    const labelItem = page.locator('#labelList ui5-li', { hasText: 'projekt' });
    await expect(labelItem).toBeVisible();
    await labelItem.click();
    await expect(page.locator('#notesTitle')).toHaveText('Label: projekt');
    await expect(listItems(page)).toHaveCount(1);

    await page.locator('#allNotesItem').click();
    await openNote(page, 'Sprint-Planung');
    // First Backspace selects the last token, the second deletes it. Use the
    // page keyboard: locator.press() would move focus back into the input.
    await input.focus();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#labelInput ui5-token')).toHaveCount(1);
    await expect(page.locator('#labelList ui5-li', { hasText: 'projekt' })).toHaveCount(0);
  });
});

test.describe('images', () => {
  test('pasting an image stores it, asks for alt text and shows it', async ({ page }) => {
    await openApp(page);
    await page.locator('#newNoteButton').click();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('# Bild');
    await page.keyboard.press('Enter');

    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, PIXEL_PNG);

    const altInput = page.locator('ui5-dialog ui5-input input');
    await expect(altInput).toBeVisible();
    await altInput.fill('Roter Punkt');
    await altInput.press('Enter');
    await expect(page.locator('ui5-dialog')).toHaveCount(0);

    expect(await editorDoc(page)).toMatch(/^# Bild\n!\[Roter Punkt\]\(assets\/[0-9a-f]{16}\.png\)$/);

    await page.keyboard.press('Control+Home');
    const img = page.locator('img.cm-md-image');
    await expect(img).toHaveAttribute('alt', 'Roter Punkt');
    await expect(img).toHaveAttribute('src', /^blob:/);
  });
});

test.describe('code blocks', () => {
  test('change the language and copy the code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);
    await openNote(page, 'Willkommen');

    const tools = page.locator('.cm-md-codetools');
    await expect(tools).toBeVisible();
    const select = tools.locator('select');
    await expect(select).toHaveValue('ts');
    await select.selectOption('javascript');
    expect(await editorDoc(page)).toContain('```javascript\nfunction greet');

    await tools.locator('button').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('function greet(name: string)');
    await expect(page.locator('#announcer')).toHaveText('Code kopiert');
  });
});

test.describe('search', () => {
  test('finds words deep inside the body and shows a snippet', async ({ page }) => {
    await openApp(page);
    await page.locator('#searchInput input').fill('durchgestrichenes');
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page).first()).toHaveAttribute('description', /Durchgestrichenes/);
  });
});

test.describe('trash', () => {
  test('delete, restore and delete permanently', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Einkauf');
    await page.locator('#deleteButton').click();
    await expect(listItems(page)).toHaveCount(2);
    await expect(page.locator('#announcer')).toContainText('in den Papierkorb verschoben');

    await page.locator('#trashItem').click();
    await expect(page.locator('#notesTitle')).toHaveText('Papierkorb');
    await expect(listItems(page)).toHaveCount(1);
    await listItems(page).first().click();
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await page.locator('#restoreButton').click();
    await expect(listItems(page)).toHaveCount(0);

    await page.locator('#allNotesItem').click();
    await expect(listItems(page)).toHaveCount(3);

    await openNote(page, 'Einkauf');
    await page.locator('#deleteButton').click();
    await page.locator('#trashItem').click();
    await listItems(page).first().click();
    await page.locator('#deleteForeverButton').click();
    await page.locator('ui5-dialog ui5-button', { hasText: 'Endgültig löschen' }).click();
    await expect(listItems(page)).toHaveCount(0);
    await page.locator('#allNotesItem').click();
    await expect(listItems(page)).toHaveCount(2);
  });
});

test.describe('export and import', () => {
  test('copy wiki markup and save Markdown', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);
    await openNote(page, 'Sprint-Planung');

    await page.locator('#exportButton').click();
    await menuItem(page, 'exportMenu', 'Wiki-Markup kopieren');
    const wiki = await page.evaluate(() => navigator.clipboard.readText());
    expect(wiki).toContain('h1. Sprint-Planung');
    expect(wiki).toContain('# Backlog sichten');

    await page.locator('#exportButton').click();
    await menuItem(page, 'exportMenu', 'Als Markdown speichern …');
    const exports = await page.evaluate(() => (window as unknown as { __mdnotesExports: Array<{ format: string; fileName: string }> }).__mdnotesExports);
    expect(exports.at(-1)).toMatchObject({ format: 'markdown', fileName: 'sprint-planung.md' });
  });

  test('import Markdown files with the file chooser', async ({ page }) => {
    await openApp(page);
    await page.locator('#moreButton').click();
    const chooser = page.waitForEvent('filechooser');
    await menuItem(page, 'moreMenu', 'Importieren …');
    await (await chooser).setFiles({ name: 'neu.md', mimeType: 'text/markdown', buffer: Buffer.from('# Importiert\n\nHallo') });
    await expect(listItems(page)).toHaveCount(4);
    await expect(listItems(page).first()).toContainText('Importiert');
    await expect(page.locator('#announcer')).toContainText('1 importiert');
  });

  test('import Markdown files dropped onto the window', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['# Gezogen\n\nText'], 'gezogen.md', { type: 'text/markdown' }));
      document.querySelector('#notesList')!.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await expect(listItems(page)).toHaveCount(4);
    await expect(listItems(page).first()).toContainText('Gezogen');
  });
});

test.describe('outside changes', () => {
  test('reload the open note, or ask when it has unsaved edits', async ({ page }) => {
    await openApp(page);
    await openNote(page, 'Einkauf');
    const id = await noteId(page, 'Einkauf');
    const externalEdit = (body: string) =>
      page.evaluate(([noteId, text]) => (window as unknown as { __mdnotesExternalEdit: (id: string, body: string) => Promise<void> }).__mdnotesExternalEdit(noteId, text), [id, body]);

    await externalEdit('# Einkauf\n\n- Äpfel\n');
    await expect.poll(() => editorDoc(page)).toBe('# Einkauf\n\n- Äpfel\n');
    await expect(page.locator('#noticeRegion')).toContainText('neu geladen');

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('- Birnen');
    await externalEdit('# Einkauf\n\n- Kirschen\n');
    const keepMine = page.locator('#noticeRegion ui5-button', { hasText: 'Meine Version behalten' });
    await expect(keepMine).toBeVisible();
    await keepMine.click();
    await expect(page.locator('#noticeRegion')).toBeEmpty();
    expect(await editorDoc(page)).toContain('- Birnen');
  });
});

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorView: { state: { doc: { toString(): string } } } }).__editorView.state.doc.toString());
const actions = (page: Page) => page.evaluate(() => window.__mdnotesAttachmentActions ?? []);

const LINK = /\[Bericht \\\[final\\\]\.pdf\]\((assets\/[0-9a-f]{16}\.pdf)\)/;

async function newNote(page: Page, title: string) {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await page.locator('#newNoteButton').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(`# ${title}`);
  await page.keyboard.press('Enter');
}

async function pasteFiles(page: Page, files: Array<{ name: string; type: string; text: string }>) {
  await page.evaluate((list) => {
    const data = new DataTransfer();
    for (const f of list) data.items.add(new File([f.text], f.name, { type: f.type }));
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, files);
}

test.describe('attachments', () => {
  test('pasting a PDF links it; the chip opens it and shows it in the folder', async ({ page }) => {
    await newNote(page, 'Anhang');
    await pasteFiles(page, [{ name: 'Bericht [final].pdf', type: 'application/pdf', text: '%PDF-1.7' }]);
    await expect.poll(() => editorDoc(page)).toMatch(LINK);
    const src = LINK.exec(await editorDoc(page))![1];
    await expect(page.locator('#announcer')).toHaveText('1 Datei angehängt.');

    // Ctrl+Enter in the line opens the attachment; Ctrl+Shift+Enter shows it in the folder.
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Shift+Enter');
    await expect.poll(() => actions(page)).toEqual([`open:${src}`, `reveal:${src}`]);

    // Outside the cursor line the link becomes a chip with the file name.
    await page.keyboard.press('Control+Home');
    const chip = page.locator('.cm-attachment');
    await expect(chip.locator('.cm-attachment-link')).toHaveText('Bericht [final].pdf');
    await chip.locator('.cm-attachment-link').click();
    await chip.locator('ui5-button').click();
    await expect.poll(() => actions(page)).toEqual([`open:${src}`, `reveal:${src}`, `open:${src}`, `reveal:${src}`]);
    await expect(chip.locator('ui5-button')).toHaveAttribute('accessible-name', '„Bericht [final].pdf“ im Ordner zeigen');
    // The source stays plain Markdown.
    expect(await editorDoc(page)).toMatch(new RegExp(`^# Anhang\\n${LINK.source}$`));
  });

  test('programs are refused with a message, other files next to images are attached', async ({ page }) => {
    await newNote(page, 'Gemischt');
    await pasteFiles(page, [
      { name: 'setup.exe', type: 'application/x-msdownload', text: 'MZ' },
      { name: 'daten.csv', type: 'text/csv', text: 'a;b' },
    ]);
    await expect(page.locator('#errorRegion ui5-message-strip')).toContainText('„setup.exe“ wurde nicht angehängt');
    await expect.poll(() => editorDoc(page)).toMatch(/^# Gemischt\n\[daten\.csv\]\(assets\/[0-9a-f]{16}\.csv\)$/);
    expect(await editorDoc(page)).not.toContain('setup.exe');
  });

  test('"Attach file" in More actions attaches files chosen in the file dialog', async ({ page }) => {
    await newNote(page, 'Dialog');
    await page.locator('#editorMoreButton').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#editorMoreMenu ui5-menu-item[data-action="attach"]').click();
    await (await chooser).setFiles([{ name: 'Notizen.txt', mimeType: 'text/plain', buffer: Buffer.from('Hallo') }]);
    await expect.poll(() => editorDoc(page)).toMatch(/^# Dialog\n\[Notizen\.txt\]\(assets\/[0-9a-f]{16}\.txt\)$/);
    await expect(editor(page)).toBeFocused();
  });

  test('a click on the attachment in the preview opens it', async ({ page }) => {
    await newNote(page, 'Vorschau');
    await pasteFiles(page, [{ name: 'Bericht [final].pdf', type: 'application/pdf', text: '%PDF-1.7' }]);
    await expect.poll(() => editorDoc(page)).toMatch(LINK);
    const src = LINK.exec(await editorDoc(page))![1];
    await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="preview"]').click();
    const link = page.locator('#previewPane a', { hasText: 'Bericht [final].pdf' });
    await expect(link).toHaveAttribute('href', src);
    await link.click();
    await expect.poll(() => actions(page)).toEqual([`open:${src}`]);
  });
});

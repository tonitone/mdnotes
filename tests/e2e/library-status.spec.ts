import { expect, test } from './fixtures';
import { expectNoSeriousViolations } from './axe';

/** Library counter, workspace path tooltip and the fading save status (issue #22). */

const listItems = (page: import('@playwright/test').Page) => page.locator('#notesList ui5-li');

test('the library shows the number of notes and the full workspace path as tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  const count = await listItems(page).count();
  await expect(page.locator('#allNotesItem')).toHaveAttribute('additional-text', String(count));
  await expect(page.locator('#workspacePath')).toHaveAttribute('title', 'Demo-Workspace (Browser-Modus)');
  await expectNoSeriousViolations(page, 'library with counter and path tooltip');
});

test('the save status fades after a few seconds without changing its text', async ({ page }) => {
  await page.goto('/');
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(' x');
  const status = page.locator('#saveStatus');
  await expect(status).toHaveText(/Gespeichert um/);
  await expect(status).not.toHaveClass(/save-status--idle/);
  const text = await status.textContent();
  const colorOf = () => status.evaluate((node) => getComputedStyle(node).color);
  const fullStrength = await colorOf();
  await expect(status).toHaveClass(/save-status--idle/, { timeout: 10_000 });
  await expect(status).toHaveText(text ?? '');
  // The class alone proves nothing: the colour must really become calmer.
  expect(await colorOf()).not.toBe(fullStrength);
  await expect(status).toHaveAttribute('role', 'status');
});

test('the editor header shows the word and character count and keeps it current', async ({ page }) => {
  await page.goto('/');
  await listItems(page).filter({ hasText: 'Willkommen' }).first().click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  const count = page.locator('#textCount');
  await expect(count).toBeVisible();
  await expect(count).toHaveText(/^\d[\d.,]* Wörter · \d[\d.,]* Zeichen$/);
  // Not a live region: it changes with every keystroke and would flood screen readers.
  await expect(count).not.toHaveAttribute('role', /.+/);
  await expect(count).not.toHaveAttribute('aria-live', /.+/);
  const words = async () => Number(((await count.textContent()) ?? '').split(' ')[0].replace(/[.,]/g, ''));
  const before = await words();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' alpha beta gamma');
  await expect.poll(words).toBe(before + 3);
  await expectNoSeriousViolations(page, 'editor header with text count');
});

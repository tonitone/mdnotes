import { expect, test, type Page } from '@playwright/test';

/** Language setting: German and English UI, switched through the appearance menu. */

const listItems = (page: Page) => page.locator('#notesList ui5-li');

async function chooseLanguage(page: Page, menuText: string, value: string) {
  await page.locator('#themeItem').click();
  await page.locator(`ui5-menu-item[text="${menuText}"]`).click();
  await page.locator(`ui5-menu-item[data-language="${value}"]`).click();
}

test('follows the browser language (German in tests)', async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#newNoteButton')).toHaveText('Neue Notiz');
});

test('switches to English and back, and keeps the choice', async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();

  await chooseLanguage(page, 'Sprache', 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#newNoteButton')).toHaveText('New note');
  await expect(page.locator('#notesTitle')).toHaveText('Notes');
  await expect(page.locator('#allNotesItem')).toContainText('All notes');
  await expect(page.locator('#searchInput')).toHaveAttribute('placeholder', 'Search');

  // The choice survives a reload.
  await page.reload();
  await expect(page.locator('#newNoteButton')).toHaveText('New note');

  await chooseLanguage(page, 'Language', 'de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#newNoteButton')).toHaveText('Neue Notiz');
});

test('English texts in the editor, status line and dialogs', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(listItems(page).first()).toBeVisible();

  await page.locator('#newNoteButton').click();
  await expect(page.locator('#saveStatus')).toHaveText('Created');
  await expect(page.locator('.cm-content')).toHaveAttribute('aria-label', 'Note content');
  await page.keyboard.type('# English note');
  await expect(page.locator('#saveStatus')).toHaveText(/^Saved at /);

  await page.locator('#versionsButton').click();
  const dialog = page.locator('ui5-dialog');
  await expect.poll(() => dialog.evaluate((d) => (d as HTMLElement & { headerText: string }).headerText)).toBe('Versions: English note');
  await dialog.locator('ui5-button', { hasText: 'Close' }).click();
  await expect(page.locator('ui5-dialog')).toHaveCount(0);

  await page.locator('#backupItem').click();
  await expect(page.locator('ui5-dialog')).toContainText('Back up now');
  await page.locator('ui5-dialog ui5-button', { hasText: 'Close' }).click();
});

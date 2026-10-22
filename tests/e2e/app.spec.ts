import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousViolations } from './axe';

const editor = (page: Page) => page.locator('.cm-content');
const listItems = (page: Page) => page.locator('#notesList ui5-li');

async function openApp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
  return errors;
}

test('starts without errors and shows the demo notes', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#browserModeStrip')).toBeVisible();
  await expect(listItems(page)).toHaveCount(3);
  await expect(listItems(page).first()).toContainText('Willkommen bei mdnotes');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('loads no resources from the network', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) external.push(req.url());
  });
  await openApp(page);
  await listItems(page).first().click();
  await expect(editor(page)).toBeVisible();
  expect(external).toEqual([]);
});

test('new note: title from first line, file name follows after a pause', async ({ page }) => {
  await openApp(page);
  await page.locator('#newNoteButton').click();
  await expect(editor(page)).toBeFocused();
  await expect(page.locator('#fileName')).toHaveText(/^neue-notiz--[0-9a-z]{6}\.md$/);

  await page.keyboard.type('# Einkauf Samstag\n\nMilch und Brot');
  await expect(page.locator('#saveStatus')).toHaveText(/Gespeichert um/);
  await expect(listItems(page).first()).toContainText('Einkauf Samstag');

  // Renaming only happens after the 4 second pause.
  await expect(page.locator('#fileName')).toHaveText(/^einkauf-samstag--[0-9a-z]{6}\.md$/, { timeout: 8000 });
});

const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editorView: { state: { doc: { toString(): string } } } }).__editorView.state.doc.toString());

test('Enter splits the line at the cursor and typing continues on the new line', async ({ page }) => {
  await openApp(page);
  await page.locator('#newNoteButton').click();
  await expect(editor(page)).toBeFocused();

  await page.keyboard.type('# Titel');
  await page.keyboard.press('Enter');
  await page.keyboard.type('abcdef');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Y');

  expect(await editorDoc(page)).toBe('# Titel\nabc\nXdef\nY');
  await expect(page.locator('.cm-line')).toHaveText(['Titel', 'abc', 'Xdef', 'Y']);
});

test('Enter in a list item continues the list', async ({ page }) => {
  await openApp(page);
  await page.locator('#notesList ui5-li', { hasText: 'Einkauf' }).click();
  await editor(page).click();
  await page.locator('.cm-line', { hasText: 'Milch' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Eier');

  expect(await editorDoc(page)).toContain('- Milch\n- Eier\n- Brot');
});

test('live preview hides Markdown outside the cursor line', async ({ page }) => {
  await openApp(page);
  await listItems(page).first().click();
  const heading = page.locator('.cm-line.cm-md-h1').first();
  await expect(heading).toBeVisible();
  // Move the cursor away from the heading so its "#" is hidden.
  await editor(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+End');
  await expect(heading).toHaveText('Willkommen bei mdnotes');
  await expect(page.locator('.cm-md-task').first()).toBeVisible();
});

test('tasks can be checked by click', async ({ page }) => {
  await openApp(page);
  await listItems(page).first().click();
  await editor(page).click();
  await page.keyboard.press('Control+End');
  const open = page.locator('.cm-md-task:not([checked])').first();
  const before = await page.locator('.cm-md-task[checked]').count();
  await open.click();
  await expect(page.locator('.cm-md-task[checked]')).toHaveCount(before + 1);
});

test('Esc then Tab leaves the editor (no keyboard trap)', async ({ page }) => {
  await openApp(page);
  await page.locator('#newNoteButton').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(editor(page)).toBeFocused(); // Tab indents
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor(page)).not.toBeFocused();
});

test('search filters the list', async ({ page }) => {
  await openApp(page);
  await page.locator('#searchInput input').fill('einkauf');
  await expect(listItems(page)).toHaveCount(1);
  await page.locator('#searchInput input').fill('gibtsnicht');
  await expect(listItems(page)).toHaveCount(0);
});

for (const [choice, theme] of [
  ['Dunkel', 'sap_horizon_dark'],
  ['Hoher Kontrast schwarz', 'sap_horizon_hcb'],
  ['Hoher Kontrast weiß', 'sap_horizon_hcw'],
] as const) {
  test(`theme switch: ${choice}`, async ({ page }) => {
    await openApp(page);
    await page.locator('#themeItem').click();
    await page.locator(`ui5-menu-item[text="${choice}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  });
}

test('no serious accessibility violations (axe, WCAG 2.2 AA)', async ({ page }) => {
  await openApp(page);
  await listItems(page).first().click();
  await expect(editor(page)).toBeVisible();
  await expectNoSeriousViolations(page);
});

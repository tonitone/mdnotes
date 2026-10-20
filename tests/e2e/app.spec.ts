import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  const open = page.locator('.cm-md-task:not(:checked)').first();
  const before = await page.locator('.cm-md-task:checked').count();
  await open.click();
  await expect(page.locator('.cm-md-task:checked')).toHaveCount(before + 1);
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
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  // List every offending node so CI annotations alone are enough to fix them.
  const report = serious.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(' > ')} | ${n.failureSummary?.replace(/\s+/g, ' ')} | ${n.html.slice(0, 160)}`),
  );
  expect(report).toEqual([]);
});

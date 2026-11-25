import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Notes from subfolders of the workspace appear in the same flat list, with
 * their folder in front of the preview. Browser mode adds them through the
 * mock adapter, as if another program had created the files.
 */

const listItems = (page: Page) => page.locator('#notesList ui5-li');
const editor = (page: Page) => page.locator('.cm-content');

async function addOutsideFile(page: Page, path: string, text: string) {
  await page.evaluate(
    ([p, t]) => (window as unknown as { __mdnotesExternalFile: (path: string, text: string) => Promise<void> }).__mdnotesExternalFile(p, t),
    [path, text],
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(listItems(page).first()).toBeVisible();
});

test('a note in a subfolder shows its folder and opens like any note', async ({ page }) => {
  await addOutsideFile(page, 'projekte/2026/plan.md', '# Quartalsplan\n\nZiele festhalten');
  const item = listItems(page).filter({ hasText: 'Quartalsplan' });
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('description', 'projekte/2026 · Ziele festhalten');
  // The full relative path is the tooltip.
  await expect(item).toHaveAttribute('tooltip', 'projekte/2026/plan.md');

  await item.click();
  await expect(editor(page)).toContainText('Ziele festhalten');
  // Root notes show no folder.
  await expect(listItems(page).filter({ hasText: 'Einkauf' })).not.toHaveAttribute('description', /·/);
});

test('notes in hidden folders and root assets stay out of the list', async ({ page }) => {
  await addOutsideFile(page, '.git/intern.md', '# Intern');
  await addOutsideFile(page, 'assets/liesmich.md', '# Liesmich');
  await addOutsideFile(page, 'archiv/alt.md', '# Archiviert');
  await expect(listItems(page).filter({ hasText: 'Archiviert' })).toHaveCount(1);
  await expect(listItems(page).filter({ hasText: 'Intern' })).toHaveCount(0);
  await expect(listItems(page).filter({ hasText: 'Liesmich' })).toHaveCount(0);
});

test('renaming by title keeps a note in its folder', async ({ page }) => {
  await addOutsideFile(page, 'projekte/plan.md', '# Plan\n\nText');
  await listItems(page).filter({ hasText: 'Plan' }).first().click();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await page.keyboard.type(' neu');
  // Leaving the note finalizes it, which renames the file after the title.
  await listItems(page).filter({ hasText: 'Einkauf' }).click();
  await expect(listItems(page).filter({ hasText: 'Plan neu' })).toHaveAttribute('tooltip', /^projekte\/plan-neu--[0-9a-z]{6}\.md$/);
});

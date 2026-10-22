import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Spike for issue #16: task checkbox as ui5-checkbox.

type View = {
  state: { doc: { length: number; toString(): string }; selection: { main: { head: number } } };
  dispatch(tr: unknown): void;
};

const editor = (page: Page) => page.locator('.cm-content');

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();
  await page.locator('#notesList ui5-li').first().click();
  await expect(editor(page)).toBeVisible();
}

/** Replaces the document and parks the cursor at the end, so task markers stay rendered. */
async function setDoc(page: Page, doc: string) {
  await page.evaluate((text) => {
    const view = (window as unknown as { __editorView: View }).__editorView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  }, doc);
}

const editorDoc = (page: Page) => page.evaluate(() => (window as unknown as { __editorView: View }).__editorView.state.doc.toString());
const cursor = (page: Page) => page.evaluate(() => (window as unknown as { __editorView: View }).__editorView.state.selection.main.head);

test.describe('task checkbox (ui5-checkbox)', () => {
  test('task line is not taller than a normal line', async ({ page }) => {
    await openApp(page);
    await setDoc(page, 'plain line\n\n- [ ] open task\n- [x] done task\n\nplain end\n');
    await page.locator('.cm-md-task').first().waitFor();
    const heights = await page.evaluate(() => {
      const lines = [...document.querySelectorAll<HTMLElement>('.cm-line')];
      const h = (el: Element) => el.getBoundingClientRect().height;
      const plain = lines.find((l) => l.textContent?.startsWith('plain line'))!;
      const task = lines.find((l) => l.querySelector('.cm-md-task'))!;
      return { plain: h(plain), task: h(task) };
    });
    expect(heights.task).toBeLessThanOrEqual(heights.plain * 1.25);
  });

  test('click toggles the task and keeps the cursor', async ({ page }) => {
    await openApp(page);
    await setDoc(page, '- [ ] first\n- [ ] second\n\nend\n');
    const before = await cursor(page);
    await page.locator('.cm-md-task').first().click();
    await expect.poll(() => editorDoc(page)).toContain('- [x] first\n- [ ] second');
    expect(await cursor(page)).toBe(before);
    await page.locator('.cm-md-task').first().click();
    await expect.poll(() => editorDoc(page)).toContain('- [ ] first');
  });

  test('announces "Aufgabe offen" and "Aufgabe erledigt"', async ({ page }) => {
    await openApp(page);
    await setDoc(page, '- [ ] a\n- [x] b\n\nend\n');
    const boxes = page.locator('.cm-md-task');
    await expect(boxes.nth(0)).toHaveAttribute('accessible-name', 'Aufgabe offen');
    await expect(boxes.nth(1)).toHaveAttribute('accessible-name', 'Aufgabe erledigt');
  });

  test('200 tasks render and toggle quickly', async ({ page }) => {
    await openApp(page);
    const doc = Array.from({ length: 200 }, (_, i) => `- [ ] task ${i}`).join('\n') + '\n\nend\n';
    const start = Date.now();
    await setDoc(page, doc);
    await expect(page.locator('.cm-md-task').first()).toBeVisible();
    const renderMs = Date.now() - start;
    const t0 = Date.now();
    await page.locator('.cm-md-task').first().click();
    await expect.poll(() => editorDoc(page)).toContain('- [x] task 0\n');
    const toggleMs = Date.now() - t0;
    expect(renderMs).toBeLessThan(5000);
    expect(toggleMs).toBeLessThan(2000);
  });
});

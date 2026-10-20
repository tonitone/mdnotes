import { expect, test, type Page } from '@playwright/test';

// Temporary diagnostics for the typing bug. Fails on purpose and puts all
// measurements into the error message, because CI logs are not reachable.

async function typeAndReport(page: Page, viewExpr: string, label: string): Promise<string> {
  const lines: string[] = [];
  const state = () =>
    page.evaluate((expr) => {
      // eslint-disable-next-line no-eval
      const view = (0, eval)(expr);
      const sel = document.getSelection();
      return `doc=${JSON.stringify(view.state.doc.toString())} head=${view.state.selection.main.head} hasFocus=${view.hasFocus} docFocus=${document.hasFocus()} rootIsDoc=${view.root === document} domSel=${sel?.anchorNode?.nodeName}:${JSON.stringify(sel?.anchorNode?.textContent?.slice(0, 12))}@${sel?.anchorOffset}`;
    }, viewExpr);
  for (const key of ['#', ' ', 'E', 'i']) {
    await page.keyboard.type(key);
    lines.push(`${label} after ${JSON.stringify(key)}: ${await state()}`);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  lines.push(`${label} after Enter+x: ${await state()}`);
  return lines.join('\n');
}

test('debug: typing in app vs. standalone editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();

  // 1) The editor inside the app (slotted into ui5-flexible-column-layout).
  await page.locator('#newNoteButton').click();
  await expect(page.locator('.cm-content').first()).toBeFocused();
  const inApp = await typeAndReport(page, 'window.__editorView', 'APP');

  // 2) The same editor factory, mounted in a plain div directly in <body>.
  await page.evaluate(async () => {
    const { createEditor } = await import('/editor/editor.ts');
    const host = document.createElement('div');
    host.id = 'plain-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:600px;height:300px;z-index:9999;background:white';
    document.body.append(host);
    const ed = createEditor(host, () => {});
    (window as any).__plainView = ed.view;
    ed.focus();
  });
  const plain = await typeAndReport(page, 'window.__plainView', 'PLAIN');

  expect(`${inApp}\n${plain}`).toBe('DEBUG');
});

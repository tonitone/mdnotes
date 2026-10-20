import { expect, test } from '@playwright/test';

// Temporary diagnostics for the typing bug. Fails on purpose and puts all
// measurements into the error message, because CI logs are not reachable.
test('debug: typing into a new note', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();

  await page.evaluate(() => {
    const log: string[] = [];
    (window as any).__log = log;
    const describe = (n: EventTarget | null) => {
      const el = n as HTMLElement | null;
      if (!el || !el.tagName) return String(n);
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
    };
    window.addEventListener('keydown', (e) => log.push(`kd-cap ${e.key} t=${describe(e.composedPath()[0])}`), true);
    window.addEventListener('keydown', (e) => log.push(`kd-bub ${e.key} prevented=${e.defaultPrevented}`));
    document.addEventListener('beforeinput', (e) => log.push(`bi ${(e as InputEvent).inputType} "${(e as InputEvent).data ?? ''}" prevented=${e.defaultPrevented}`), true);
  });

  await page.locator('#newNoteButton').click();
  await expect(page.locator('.cm-content')).toBeFocused();

  const snapshot = (label: string) =>
    page.evaluate((label) => {
      const content = document.querySelector('.cm-content') as HTMLElement;
      const sel = document.getSelection();
      const anchor = sel?.anchorNode;
      const view = (window as any).__editorView;
      const state = view
        ? `doc=${JSON.stringify(view.state.doc.toString())} head=${view.state.selection.main.head}`
        : 'no view';
      (window as any).__log.push(
        `[${label}] ${state} dom=${JSON.stringify(content.innerText)} active=${document.activeElement?.tagName} sel=${anchor?.nodeName}:${JSON.stringify(anchor?.textContent?.slice(0, 20))}@${sel?.anchorOffset}`,
      );
    }, label);

  await snapshot('start');
  for (const key of ['#', ' ', 'E', 'i', 'n']) {
    await page.keyboard.type(key);
    await snapshot(`after ${JSON.stringify(key)}`);
  }
  await page.keyboard.press('Enter');
  await snapshot('after Enter');
  await page.keyboard.type('x');
  await snapshot('after x');

  const log = await page.evaluate(() => (window as any).__log as string[]);
  expect(log.join('\n')).toBe('DEBUG');
});

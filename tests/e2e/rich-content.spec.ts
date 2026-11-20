import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Math, Mermaid and footnotes in the live preview. The fixtures fail a test on
 * any CSP violation, which is the main point here: KaTeX and Mermaid emit inline styles.
 */

interface TestView {
  state: { doc: { toString(): string } };
  dispatch(spec: unknown): void;
  focus(): void;
}

async function setText(page: Page, text: string) {
  await page.goto('/');
  const items = page.locator('#notesList ui5-li');
  await expect(items.first()).toBeVisible();
  await items.filter({ hasText: 'Willkommen' }).first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate((text) => {
    const v = (window as unknown as { __editorView: TestView }).__editorView;
    // The caret goes to the last line so that nothing above is in editing mode.
    v.dispatch({ changes: { from: 0, to: v.state.doc.toString().length, insert: text }, selection: { anchor: text.length } });
    v.focus();
  }, text);
}

test('math is rendered as MathML without CSP violations', async ({ page }) => {
  await setText(page, 'Inline $x^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\nlast line');
  await expect(page.locator('.cm-md-math math').first()).toBeVisible();
  await expect(page.locator('.cm-md-math-block math')).toBeVisible();
});

test('a mermaid block is rendered as an SVG diagram', async ({ page }) => {
  await setText(page, '```mermaid\ngraph TD\n  A-->B\n```\n\nlast line');
  await expect(page.locator('.cm-md-diagram svg')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cm-md-diagram')).toHaveAttribute('role', 'img');
});

test('an invalid mermaid block shows an error and keeps the source', async ({ page }) => {
  await setText(page, '```mermaid\nnot a diagram at all\n```\n\nlast line');
  await expect(page.locator('.cm-md-diagram-error pre')).toContainText('not a diagram at all');
});

test('footnote references and definitions are marked', async ({ page }) => {
  await setText(page, 'Text[^1]\n\n[^1]: The note.\n\nlast line');
  await expect(page.locator('.cm-md-footnote-ref')).toHaveText('[^1]');
  await expect(page.locator('.cm-md-footnote-def')).toHaveText('[^1]');
});

test('footnote links jump within the preview', async ({ page }) => {
  await setText(page, 'Text[^1]\n\n[^1]: The note.\n\nlast line');
  await page.locator('#viewModeButton ui5-segmented-button-item[data-mode="preview"]').click();
  await expect(page.locator('#editorArea')).toHaveAttribute('data-mode', 'preview');
  const preview = page.locator('#previewPane');
  await preview.locator('#fnref-1').click();
  await expect(preview.locator('#fn-1 .footnote-back')).toBeFocused();
  await preview.locator('#fn-1 .footnote-back').click();
  await expect(preview.locator('#fnref-1')).toBeFocused();
});

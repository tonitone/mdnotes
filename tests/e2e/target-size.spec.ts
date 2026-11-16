import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * WCAG 2.2 SC 2.5.8 (Target Size, Minimum, AA): every pointer target is at
 * least 24 x 24 CSS px, or a 24 px circle centred on it touches no other
 * target (spacing exception). The check measures the hosts of UI5 controls
 * and the native controls in the light DOM; UI5 internals are not touched.
 */

const TARGETS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  'ui5-button',
  'ui5-toggle-button',
  'ui5-segmented-button-item',
  'ui5-select',
  'ui5-checkbox',
  'ui5-switch',
  'ui5-toolbar-button',
  'ui5-toolbar-select',
  'ui5-shellbar-item',
  'ui5-menu-item',
  'ui5-li',
  'ui5-input',
].join(',');

interface Box {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function measure(page: Page): Promise<Box[]> {
  return page.evaluate((selector) => {
    const seen = new Set<Element>();
    const boxes: Box[] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // Skip elements hidden by an ancestor (closed popovers, collapsed columns).
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      boxes.push({
        name: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    }
    return boxes;
  }, TARGETS);
}

/** Distance from a point to the nearest point of a box (0 when inside). */
function distanceToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b.left - x, 0, x - b.right);
  const dy = Math.max(b.top - y, 0, y - b.bottom);
  return Math.hypot(dx, dy);
}

/** Returns one line per target that is too small and has no spacing exception. */
export function findSmallTargets(boxes: Box[]): string[] {
  const failures: string[] = [];
  boxes.forEach((box, i) => {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    if (w >= 23.5 && h >= 23.5) return;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const crowded = boxes.some((other, j) => {
      if (i === j) return false;
      // Nested targets (a button inside a list item) do not count as neighbours.
      const contains = other.left <= box.left && other.top <= box.top && other.right >= box.right && other.bottom >= box.bottom;
      if (contains) return false;
      return distanceToBox(cx, cy, other) < 12;
    });
    if (crowded) failures.push(`${box.name}: ${w.toFixed(1)} x ${h.toFixed(1)} px`);
  });
  return failures;
}

for (const density of ['compact', 'cozy'] as const) {
  for (const theme of ['light', 'hcb'] as const) {
    test(`every target is at least 24 x 24 px or has spacing: density ${density}, theme ${theme}`, async ({ page }) => {
      await page.addInitScript(
        ([d, t]) => {
          localStorage.setItem('mdnotes.density', d);
          localStorage.setItem('mdnotes.theme', t);
        },
        [density, theme],
      );
      await page.goto('/');
      await expect(page.locator('#notesList ui5-li').first()).toBeVisible();
      await page.locator('#notesList ui5-li').filter({ hasText: 'Willkommen' }).first().click();
      await expect(page.locator('.cm-content')).toBeVisible();
      // Task checkboxes and code tools are part of the note content.
      await page.waitForTimeout(300);
      const boxes = await measure(page);
      expect(boxes.length).toBeGreaterThan(5);
      expect(findSmallTargets(boxes)).toEqual([]);
    });
  }
}

test('the task checkbox is at least 24 x 24 px', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#notesList ui5-li').first()).toBeVisible();
  await page.locator('#notesList ui5-li').filter({ hasText: 'Willkommen' }).first().click();
  const box = await page.locator('.cm-md-task').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
});

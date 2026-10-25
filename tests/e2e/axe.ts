import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA, which EN 301 549 references for software. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Violations inside UI5 components that the app cannot fix. Keep this list
 * short, name the UI5 version and remove entries once UI5 fixes them.
 */
const KNOWN_UI5_ISSUES: Array<{ rule: string; target: string; summary?: string; reason: string }> = [
  {
    rule: 'nested-interactive',
    target: '.ui5-fcl-separator',
    reason: 'UI5 2.27.2: the FCL column separator (role=separator) contains its focusable resize grip.',
  },
  {
    rule: 'aria-required-children',
    target: '#editorMoreMenu',
    summary: 'ui5-responsive-popover[tabindex]',
    reason:
      'UI5 2.27.2: an open submenu. ui5-menu-item renders the submenu popover next to its menu item in its own ' +
      'shadow root (MenuItemTemplate.tsx, listItemPostContent), so it ends up inside the parent ul[role=menu]; ' +
      'Popup.onEnterDOM sets tabIndex = -1 on it (Popup.ts:291), so axe counts it as a focusable non-menuitem child.',
  },
];

function isKnownUi5Issue(rule: string, target: string, summary = ''): boolean {
  return KNOWN_UI5_ISSUES.some(
    (issue) => issue.rule === rule && target.includes(issue.target) && (!issue.summary || summary.includes(issue.summary)),
  );
}

/**
 * Runs axe on the whole page (including open dialogs, menus and shadow DOM)
 * and fails with one line per offending node, so CI annotations alone are
 * enough to fix them.
 */
export async function expectNoSeriousViolations(page: Page, context = ''): Promise<void> {
  // Toasts fade in and out; axe would measure contrast mid-animation. Their
  // text is also announced through the #announcer live region.
  await page.evaluate(() => {
    const toast = document.getElementById('toast') as (HTMLElement & { open: boolean }) | null;
    if (toast) toast.open = false;
  });
  // Let UI5 finish opening animations and re-rendering before scanning.
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const report = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) =>
      v.nodes
        .filter((n) => !isKnownUi5Issue(v.id, n.target.join(' > '), n.failureSummary))
        .map((n) => `${context ? `[${context}] ` : ''}${v.id}: ${n.target.join(' > ')} | ${n.failureSummary?.replace(/\s+/g, ' ')} | ${n.html.slice(0, 160)}`),
    );
  expect(report).toEqual([]);
}

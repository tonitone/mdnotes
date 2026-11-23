/**
 * Brings markup from a library (KaTeX, Mermaid) into the page under the
 * strict CSP: no `style` attributes and no `<style>` elements without nonce.
 *
 * The markup is parsed in an inert document. Inline styles are taken out of
 * the attributes and applied through the CSSOM afterwards, `<style>` elements
 * become constructable style sheets. Neither is restricted by the CSP.
 */

export interface AdoptedMarkup {
  node: Element;
  /** Style sheets added to the document. Pass to `releaseSheets` when the markup goes away. */
  sheets: CSSStyleSheet[];
}

export function adoptMarkup(markup: string, type: 'text/html' | 'image/svg+xml'): AdoptedMarkup | null {
  const doc = new DOMParser().parseFromString(markup, type);
  const root = type === 'text/html' ? doc.body.firstElementChild : doc.documentElement;
  if (!root || root.localName === 'parsererror') return null;

  // Scripts and event handlers must never survive, whatever the library emits.
  root.querySelectorAll('script').forEach((el) => el.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }

  const css: string[] = [];
  root.querySelectorAll('style').forEach((el) => {
    css.push(el.textContent ?? '');
    el.remove();
  });

  const inline: Array<[number, string]> = [];
  [root, ...root.querySelectorAll('*')].forEach((el, index) => {
    const value = el.getAttribute('style');
    if (value === null) return;
    inline.push([index, value]);
    el.removeAttribute('style');
  });

  const node = document.importNode(root, true);
  const all = [node, ...node.querySelectorAll('*')];
  for (const [index, value] of inline) {
    const target = all[index] as Element & ElementCSSInlineStyle;
    if (target?.style) target.style.cssText = value;
  }

  const sheets = css
    .filter((text) => text.trim())
    .map((text) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return sheet;
    });
  if (sheets.length) document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...sheets];
  return { node, sheets };
}

export function releaseSheets(sheets: CSSStyleSheet[]): void {
  if (sheets.length) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => !sheets.includes(s));
}

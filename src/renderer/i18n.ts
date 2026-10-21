import { setLanguage as setUi5Language } from '@ui5/webcomponents-base/dist/config/Language.js';
import { setLocale, t, textDirection, type Locale, type MessageKey } from '../shared/i18n';

/**
 * Applies the locale to the page: shared translations, UI5's own texts,
 * `lang` and `dir` on <html>, and the static texts in index.html.
 *
 * Static elements carry their key in `data-i18n` (text content) and
 * `data-i18n-attr` ("attribute:key; attribute:key").
 */
export async function applyLocale(locale: Locale): Promise<void> {
  setLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = textDirection(locale);
  await setUi5Language(locale);
  translateDom(document);
}

export function translateDom(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n as MessageKey);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of (node.dataset.i18nAttr ?? '').split(';')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (attr && key) node.setAttribute(attr, t(key as MessageKey));
    }
  }
}

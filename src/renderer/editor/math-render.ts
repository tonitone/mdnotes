import { adoptMarkup, type AdoptedMarkup } from './csp-dom';

/**
 * TeX to MathML with KaTeX, loaded on first use. MathML output needs neither
 * KaTeX fonts nor its CSS, Chromium renders it natively, and screen readers
 * can read it.
 */
const cache = new Map<string, string>();

export async function renderMath(tex: string, display: boolean): Promise<AdoptedMarkup | null> {
  const key = `${display ? 'b' : 'i'}:${tex}`;
  let markup = cache.get(key);
  if (markup === undefined) {
    const { default: katex } = await import('katex');
    markup = katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, strict: 'ignore', trust: false });
    if (cache.size > 200) cache.clear();
    cache.set(key, markup);
  }
  return adoptMarkup(markup, 'text/html');
}

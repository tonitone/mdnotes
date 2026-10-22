import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * CodeMirror adds its styles as <style> elements when mounted on the
 * document (we pass `root: document`, see editor.ts). The production CSP
 * allows those only with the nonce that the build writes into
 * <meta name="csp-nonce"> (vite-plugins/csp.ts). In dev mode there is no
 * nonce and inline styles are allowed.
 */
export function cspNonce(): Extension {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  return nonce ? EditorView.cspNonce.of(nonce) : [];
}

import { randomBytes } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Injects the Content Security Policy as a meta tag.
 *
 * - Scripts only from the app itself: no eval, no inline scripts, no
 *   inline event handlers.
 * - Styles only from the app's own files, no style attributes. UI5 uses
 *   constructable style sheets and the CSSOM, which CSP does not restrict.
 *   CodeMirror writes <style> elements; those carry a nonce that is created
 *   per build and handed to CodeMirror through <meta name="csp-nonce">.
 *   A per-build nonce is enough here: the app loads no remote content, has
 *   no network access, and Chromium hides nonces from CSS selectors.
 * - The Vite dev server injects CSS as <style> tags, so dev mode allows
 *   inline styles (and sets no nonce, which would disable 'unsafe-inline').
 * - No outbound connections. In dev mode also a WebSocket to the local
 *   Vite server for hot reload.
 *
 * Violations are logged and collected by src/renderer/csp-report.ts; the
 * e2e and Electron tests fail on any violation.
 */
export function cspPlugin(): Plugin {
  let isDev = false;
  const nonce = randomBytes(18).toString('base64');
  return {
    name: 'mdnotes-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'none'",
        "script-src 'self'",
        "script-src-attr 'none'",
        isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
        isDev ? "style-src-attr 'unsafe-inline'" : "style-src-attr 'none'",
        "img-src 'self' data: blob: mdnotes-asset:",
        "font-src 'self' data:",
        isDev ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
      ].join('; ');
      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
        ...(isDev ? [] : [{ tag: 'meta', attrs: { name: 'csp-nonce', content: nonce }, injectTo: 'head' as const }]),
      ];
    },
  };
}

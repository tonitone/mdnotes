import type { Plugin } from 'vite';

/**
 * Injects the Content Security Policy as a meta tag.
 *
 * - Scripts only from the app itself: no eval, no inline scripts, no
 *   inline event handlers.
 * - Styles only from the app's own files. UI5 and CodeMirror add their
 *   styles as constructable style sheets and through the CSSOM, which the
 *   policy does not restrict, so no 'unsafe-inline' is needed. The Vite dev
 *   server injects CSS as <style> tags, so dev mode still allows inline styles.
 * - No outbound connections. In dev mode also a WebSocket to the local
 *   Vite server for hot reload.
 *
 * Violations are logged and collected by src/renderer/csp-report.ts; the
 * e2e and Electron tests fail on any violation.
 */
export function cspPlugin(): Plugin {
  let isDev = false;
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
        isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
        "img-src 'self' data: blob: mdnotes-asset:",
        "font-src 'self' data:",
        isDev ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

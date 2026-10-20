import type { Plugin } from 'vite';

/**
 * Injects the Content Security Policy as a meta tag.
 *
 * - Scripts only from the app itself: no eval, no inline scripts.
 * - No outbound connections. In dev mode also a WebSocket to the local
 *   Vite server for hot reload.
 * - Inline styles are allowed for now because UI5 and CodeMirror set styles
 *   at runtime. To be reviewed and tightened in phase 4.
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
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        isDev ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*" : "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

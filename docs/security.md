# Security

- The renderer has no Node access (`contextIsolation`, `sandbox`), IPC only from the app's own
  window, arguments are checked in the main process.
- All network requests are blocked. Links open in the default browser.
- Content Security Policy without inline scripts, without inline styles and without `style`
  attributes. CodeMirror's `<style>` elements carry a nonce that is created at build time.
  The UI tests run against the production build and fail on every CSP violation
  (`src/renderer/csp-report.ts`).
- Exported HTML files contain no scripts and only load embedded images or images over https.
- Attachments: files whose extension runs code when opened (`BLOCKED_EXTENSIONS` in
  `src/shared/assets.ts`: programs, scripts, installers, shortcuts) are never stored. The main
  process checks the name again and opens only existing files in `assets/` with a content-hash name
  (`shell.openPath`). The asset protocol serves images only, so a stored HTML or PDF file is never
  rendered inside the app window.

## Libraries that emit inline styles (KaTeX, Mermaid)

The CSP forbids `style` attributes and `<style>` elements without a nonce. The CSP of the app is not relaxed.

- KaTeX runs with MathML output. `src/renderer/editor/csp-dom.ts` moves any remaining inline
  styles to the CSSOM and `<style>` elements to constructable style sheets.
- Mermaid writes inline styles into the live DOM while it measures text. It therefore runs in a
  hidden iframe (`src/renderer/mermaid.html`, `mermaid-frame.ts`) with its own policy
  (`MERMAID_POLICY` in `vite-plugins/csp.ts`): inline styles are allowed there, scripts still only
  come from the app, nothing else may be loaded. The app allows this one frame with `frame-src 'self'`.
  The finished SVG comes back as a string and is shown as an `<img>` with a `data:` URL, so its styles
  never reach the app's document. Mermaid runs with `securityLevel: 'strict'` and without HTML labels.

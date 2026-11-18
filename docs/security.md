# Security

- The renderer has no Node access (`contextIsolation`, `sandbox`), IPC only from the app's own
  window, arguments are checked in the main process.
- All network requests are blocked. Links open in the default browser.
- Content Security Policy without inline scripts, without inline styles and without `style`
  attributes. CodeMirror's `<style>` elements carry a nonce that is created at build time.
  The UI tests run against the production build and fail on every CSP violation
  (`src/renderer/csp-report.ts`).
- Exported HTML files contain no scripts and only load embedded images or images over https.

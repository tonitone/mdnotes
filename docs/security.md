# Security

- The renderer has no Node access (`contextIsolation`, `sandbox`), IPC only from the app's own
  window, arguments are checked in the main process.
- All network requests are blocked. Links open in the default browser.
- Content Security Policy without inline scripts, without inline styles and without `style`
  attributes. CodeMirror's `<style>` elements carry a nonce that is created at build time.
  The UI tests run against the production build and fail on every CSP violation
  (`src/renderer/csp-report.ts`).
- Exported HTML files contain no scripts and only load embedded images or images over https.

## Libraries that emit inline styles (KaTeX, Mermaid)

The CSP forbids `style` attributes and `<style>` elements without a nonce. KaTeX and Mermaid
produce both, so `src/renderer/editor/csp-dom.ts` parses their output in an inert document,
removes the inline styles, applies them through the CSSOM and turns `<style>` elements into
constructable style sheets. KaTeX is set to MathML output. Mermaid runs with `securityLevel: 'strict'`
and without HTML labels. The CSP itself is not relaxed.

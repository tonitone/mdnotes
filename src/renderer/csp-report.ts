/**
 * Collects Content Security Policy violations. Imported first, so it also
 * sees violations caused while other modules load. Tests read
 * `window.__cspViolations` and fail if it is not empty.
 */

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

const violations: string[] = (window.__cspViolations = []);

document.addEventListener('securitypolicyviolation', (event) => {
  const where = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}` : '';
  const message = `${event.effectiveDirective}: blocked ${event.blockedURI || 'inline'}${where} (${event.sample})`;
  violations.push(message);
  console.error(`CSP violation: ${message}`);
});

export {};

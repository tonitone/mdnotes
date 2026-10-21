import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cspPlugin } from './vite-plugins/csp';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Browser mode: the UI only, with a mock adapter instead of the file system.
 * For fast development and automated tests. Never shipped.
 */
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  define: { __BROWSER_MODE__: 'true' },
  plugins: [cspPlugin()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  // Tests run against the production build (strict CSP, as in the app).
  preview: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { outDir: resolve(root, 'out/browser'), emptyOutDir: true },
});

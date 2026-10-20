/// <reference types="vite/client" />
import type { NotesApi } from '../shared/api';

declare global {
  /** Set at build time: `true` only in browser mode (`npm run dev:browser`). */
  const __BROWSER_MODE__: boolean;

  interface Window {
    notesApi?: NotesApi;
  }
}

export {};

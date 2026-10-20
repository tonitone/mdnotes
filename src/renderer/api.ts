import type { NotesApi } from '../shared/api';

/**
 * Picks the API: in Electron the one exposed by the preload script, in
 * browser mode the mock adapter. `__BROWSER_MODE__` is a build-time
 * constant. In the Electron build it is `false`, so the bundler removes the
 * mock adapter from the shipped app entirely.
 */
export async function getApi(): Promise<NotesApi> {
  if (window.notesApi) return window.notesApi;
  if (__BROWSER_MODE__) {
    const { createMockApi } = await import('./adapters/mock-api');
    return createMockApi();
  }
  throw new Error('No connection to the main process (window.notesApi is missing).');
}

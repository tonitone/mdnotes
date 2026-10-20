/**
 * The only interface between the UI and the file system.
 *
 * In Electron the preload script exposes it as `window.notesApi` (calls go
 * to the main process via IPC). In browser mode a mock adapter with in-memory
 * notes replaces it. The UI only knows this type and does not know which
 * variant is running.
 */

export interface NoteSummary {
  id: string;
  fileName: string;
  title: string;
  preview: string;
  labels: string[];
  /** Last modification, milliseconds since the epoch. */
  modified: number;
}

export interface NoteDoc extends NoteSummary {
  body: string;
  created: string;
}

export interface SaveResult {
  id: string;
  fileName: string;
  title: string;
  preview: string;
  modified: number;
}

export type MenuCommand = 'new-note' | 'choose-workspace' | 'find';

export interface NotesApi {
  readonly mode: 'electron' | 'browser';
  /** Path or name of the current workspace, `null` on first start. */
  getWorkspace(): Promise<string | null>;
  /** Opens the folder dialog. `null` if cancelled. */
  chooseWorkspace(): Promise<string | null>;
  listNotes(): Promise<NoteSummary[]>;
  readNote(id: string): Promise<NoteDoc>;
  createNote(): Promise<NoteDoc>;
  /** Saves the content without renaming the file. */
  saveNote(id: string, body: string): Promise<SaveResult>;
  /** Renames the file after the current title, if needed. */
  finalizeNote(id: string): Promise<SaveResult>;
  /** Commands from the native menu. Returns an unsubscribe function. */
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  /** The main process wants to close: save pending changes before the callback resolves. */
  onFlushRequest(callback: () => Promise<void>): () => void;
}

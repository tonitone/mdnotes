/**
 * The only interface between the UI and the file system.
 *
 * In Electron the preload script exposes it as `window.notesApi` (calls go
 * to the main process via IPC). In browser mode a mock adapter with in-memory
 * notes replaces it. The UI only knows this type and does not know which
 * variant is running.
 */

import type { LanguageChoice, Locale } from './i18n';

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

export interface SearchHit {
  id: string;
  /** Text around the first match, for the list description. */
  snippet: string;
}

export interface TrashEntry {
  trashName: string;
  title: string;
  preview: string;
  /** When the note was deleted, milliseconds since the epoch. */
  trashedAt: number;
}

export interface ImportReport {
  imported: number;
  skipped: number;
  warnings: string[];
}

export interface NotesChangedEvent {
  /** Notes whose file was changed outside the app. */
  changed: string[];
  /** Notes whose file was deleted outside the app. */
  removed: string[];
  /** Notes added outside the app. */
  added: string[];
}

export type ExportFormat = 'markdown' | 'wiki' | 'pdf' | 'html' | 'docx';

export interface VersionSummary {
  name: string;
  /** When the version was taken, milliseconds since the epoch. */
  time: number;
}

export type BackupKind = 'manual' | 'auto' | 'safety';

export interface BackupInfo {
  /** File name inside the backup folder. */
  file: string;
  created: number;
  kind: BackupKind;
  size: number;
}

export interface BackupSettings {
  folder: string | null;
  /** Automatic backups: never, when quitting, or once a day. */
  auto: 'off' | 'quit' | 'daily';
  includeHistory: boolean;
  /** How many backups to keep. */
  keep: number;
}

export interface RecoveryEntry {
  id: string;
  title: string;
  body: string;
  /** When the unsaved text was written, milliseconds since the epoch. */
  savedAt: number;
}

export type MenuCommand =
  | 'new-note'
  | 'choose-workspace'
  | 'find'
  | 'delete-note'
  | 'import'
  | 'export-all'
  | 'versions'
  | 'backup'
  | 'view-edit'
  | 'view-split'
  | 'view-preview';

export interface LanguageInfo {
  choice: LanguageChoice;
  locale: Locale;
}

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
  setLabels(id: string, labels: string[]): Promise<NoteSummary>;
  /** Full-text search; every word must occur in title or body. */
  searchNotes(query: string): Promise<SearchHit[]>;

  /** Moves a note to the trash. */
  trashNote(id: string): Promise<void>;
  listTrash(): Promise<TrashEntry[]>;
  readTrash(trashName: string): Promise<string>;
  restoreFromTrash(trashName: string): Promise<NoteSummary>;
  deleteFromTrash(trashName: string): Promise<void>;

  /** Stores an image in `assets/` and returns the relative path for Markdown. */
  saveAsset(bytes: Uint8Array, mime: string): Promise<string>;
  /** URL the UI can load for a relative image path, or `null` if not local. */
  assetUrl(src: string): string | null;

  /** Exports one note with a save dialog. Returns the saved path, or `null` if cancelled. */
  exportNote(id: string, format: ExportFormat): Promise<string | null>;
  /** Exports all notes (with images) into a new folder. Returns the folder, or `null`. */
  exportAll(): Promise<string | null>;
  /** Imports Markdown files chosen in a dialog. `null` if cancelled. */
  importNotes(): Promise<ImportReport | null>;
  /** Imports dropped Markdown files (text only, no image lookup). */
  importTexts(files: Array<{ name: string; text: string }>): Promise<ImportReport>;

  /** Versions of a note, newest first. */
  listVersions(id: string): Promise<VersionSummary[]>;
  readVersion(id: string, name: string): Promise<string>;
  /** Makes a version current; the previous content stays available as a version. */
  restoreVersion(id: string, name: string): Promise<NoteDoc>;
  /** Renames (or merges) a label in all notes. Returns the changed notes. */
  renameLabel(from: string, to: string): Promise<NoteSummary[]>;

  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(patch: Partial<Omit<BackupSettings, 'folder'>>): Promise<BackupSettings>;
  /** Opens a folder dialog for the backup location. `null` if cancelled. */
  chooseBackupFolder(): Promise<BackupSettings | null>;
  createBackup(): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  verifyBackup(file: string): Promise<{ ok: boolean; files: number; problems: string[] }>;
  listBackupNotes(file: string): Promise<Array<{ path: string; title: string }>>;
  restoreBackupNotes(file: string, paths: string[]): Promise<ImportReport>;
  /** Restores a whole backup into an empty folder chosen in a dialog and opens it. Returns the folder. */
  restoreBackupToFolder(file: string): Promise<string | null>;

  /** Crash recovery: keeps unsaved editor content outside the workspace. */
  writeRecovery(id: string, body: string): Promise<void>;
  clearRecovery(id: string): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;

  /** Language setting and the locale it resolves to (the OS decides for `system`). */
  getLanguage(): Promise<LanguageInfo>;
  /** Saves the language setting. The UI reloads afterwards to apply it. */
  setLanguage(choice: LanguageChoice): Promise<LanguageInfo>;

  /** Commands from the native menu. Returns an unsubscribe function. */
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  /** The main process wants to close: save pending changes before the callback resolves. */
  onFlushRequest(callback: () => Promise<void>): () => void;
  /** Files changed outside the app (e.g. another editor or a sync tool). */
  onNotesChanged(callback: (event: NotesChangedEvent) => void): () => void;
}

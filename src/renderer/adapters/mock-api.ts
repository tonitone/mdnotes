import type { BackupInfo, BackupSettings, ExportFormat, ImportReport, NotesApi, NotesChangedEvent } from '../../shared/api';
import { assetNameFor, assetNameFromPath, attachmentNameFor, attachmentNameFromPath, isAllowedAttachment, isImageAssetName } from '../../shared/assets';
import { MemoryFs } from '../../shared/fs-port';
import { markdownToHtmlDocument } from '../../shared/markdown/html';
import { markdownToWiki } from '../../shared/markdown/wiki';
import { newId, parseNote, serializeNote, slugify, titleFromBody } from '../../shared/note';
import { NoteStore } from '../../shared/note-store';
import { DEFAULT_NOTE_SORT, isNoteSort } from '../../shared/note-list';
import { isLanguageChoice, resolveLocale, t, type LanguageChoice } from '../../shared/i18n';

/**
 * Browser mode: the same NoteStore logic as in Electron, but on top of an
 * in-memory file system. For development and automated tests only; never
 * shipped with the app (see __BROWSER_MODE__).
 */

const DEMO_NOTES: Array<{ labels: string[]; body: string; ageMinutes: number }> = [
  {
    labels: ['start'],
    ageMinutes: 1,
    body: `# Willkommen bei mdnotes

Das ist der **Browser-Modus**. Änderungen bleiben nur bis zum Neuladen erhalten.

## Live Preview

Markdown wird beim Tippen dargestellt. Steht der Cursor in einer Zeile, siehst du die *Auszeichnung*, sonst nur das Ergebnis. Auch \`Inline-Code\`, ~~Durchgestrichenes~~ und [Links](https://example.com) funktionieren.

> Zitate werden eingerückt dargestellt.

- [x] Notiz anlegen
- [ ] Titel ändern und beobachten, wie sich der Dateiname anpasst
- [ ] Mit Esc und dann Tab den Editor verlassen

\`\`\`ts
function greet(name: string): string {
  return \`Hallo \${name}\`;
}
\`\`\`
`,
  },
  {
    labels: ['arbeit'],
    ageMinutes: 90,
    body: `# Sprint-Planung

1. Backlog sichten
2. Aufwände schätzen
3. Ziele festhalten

| Thema | Status | Aufwand |
| :--- | :---: | ---: |
| Export nach Confluence | offen | 3 |
| Tabellen in der Vorschau | ✅ fertig | 2 |

Offene Frage: Brauchen wir den Export nach Confluence schon im ersten Release?
`,
  },
  {
    labels: [],
    ageMinutes: 60 * 26,
    body: `# Einkauf

- Milch
- Brot
- Kaffee
`,
  },
];

/** Exports made in browser mode, for e2e tests. */
export interface MockExport {
  format: ExportFormat | 'all';
  fileName: string;
  content: string;
}

declare global {
  interface Window {
    __mdnotesExports?: MockExport[];
    /** e2e tests: change a note's file as if another program did it. */
    __mdnotesExternalEdit?: (id: string, body: string) => Promise<void>;
    __mdnotesExternalFile?: (path: string, text: string) => Promise<void>;
    /** e2e tests: attachments opened or shown in the folder, as `open:assets/…` or `reveal:assets/…`. */
    __mdnotesAttachmentActions?: string[];
    /** e2e tests: delay in ms before an image or attachment is stored, to test notes switched meanwhile. */
    __mdnotesAssetDelayMs?: number;
    /** e2e tests: delay in ms before a version is read, by version name, to test reads finishing out of order. */
    __mdnotesVersionReadDelayMs?: Record<string, number>;
    /** e2e tests: delay in ms before a version or taken blocks are restored, to test a pending write. */
    __mdnotesVersionWriteDelayMs?: number;
  }
}

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => window.setTimeout(resolve, ms)) : Promise.resolve());

function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lets the user pick Markdown files with a regular file input. */
function pickFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.addEventListener('change', () => resolve(input.files ? [...input.files] : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const LANGUAGE_KEY = 'mdnotes.language';
/** Browser mode keeps the list order in localStorage; Electron keeps it in config.json. */
const NOTE_SORT_KEY = 'mdnotes.noteSort';

/** `?lang=en` in the URL wins (for tests), then the stored choice. */
function readLanguage(): LanguageChoice {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLanguageChoice(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (isLanguageChoice(stored)) return stored;
  } catch {
    // Storage blocked.
  }
  return 'system';
}

export async function createMockApi(): Promise<NotesApi> {
  const fs = new MemoryFs(true);
  // Store in reverse so the welcome note is the newest.
  for (const demo of [...DEMO_NOTES].reverse()) {
    const created = new Date(Date.now() - demo.ageMinutes * 60_000);
    const id = newId(created.getTime());
    fs.putExternal(`demo-${id.slice(-6).toLowerCase()}.md`, serializeNote({ id, labels: demo.labels, created: created.toISOString() }, demo.body));
  }
  const store = new NoteStore(fs);
  await store.scan();
  // Give the demo files their real names right away.
  for (const note of store.summaries()) await store.finalize(note.id);

  const workspaceName = 'Demo-Workspace (Browser-Modus)';
  const noop = () => () => undefined;
  const assetUrls = new Map<string, string>();
  const changeListeners = new Set<(event: NotesChangedEvent) => void>();
  const exports: MockExport[] = (window.__mdnotesExports = []);
  const attachmentActions: string[] = (window.__mdnotesAttachmentActions = []);
  const assetDelay = () => new Promise((resolve) => window.setTimeout(resolve, window.__mdnotesAssetDelayMs ?? 0));
  const requireAttachment = async (src: string): Promise<string> => {
    const name = attachmentNameFromPath(src);
    if (!name) throw new Error('Invalid attachment.');
    await fs.readAsset(name); // throws if it is gone
    return `assets/${name}`;
  };
  // Browser mode keeps backups and recovery data in memory only.
  let backupSettings: BackupSettings = { folder: null, auto: 'off', includeHistory: false, keep: 10 };
  // Resolved on use: the locale is only set after the mock is created.
  const settings = () => ({ ...backupSettings, folder: t('backup.browserFolder') });
  const backups: Array<{ info: BackupInfo; files: Map<string, string> }> = [];
  const recovery = new Map<string, { body: string; savedAt: number }>();
  const findBackup = (file: string) => {
    const backup = backups.find((b) => b.info.file === file);
    if (!backup) throw new Error(`Unknown backup: ${file}`);
    return backup;
  };

  window.__mdnotesExternalEdit = async (id, body) => {
    const fileName = store.read(id).fileName;
    fs.putExternal(fileName, store.fileText(id).replace(/\n---\n[\s\S]*$/, `\n---\n${body}`));
    const event = await store.refresh();
    changeListeners.forEach((listener) => listener(event));
  };
  // Tests only: a file that appears outside the app, e.g. in a subfolder.
  window.__mdnotesExternalFile = async (path, text) => {
    fs.putExternal(path, text);
    const event = await store.refresh();
    changeListeners.forEach((listener) => listener(event));
  };

  const importTexts = async (files: Array<{ name: string; text: string }>): Promise<ImportReport> => {
    const report: ImportReport = { imported: 0, skipped: 0, warnings: [] };
    for (const { name, text } of files) {
      if (await store.importNote(text, name)) report.imported++;
      else report.skipped++;
    }
    return report;
  };

  return {
    mode: 'browser',
    getWorkspace: async () => workspaceName,
    chooseWorkspace: async () => workspaceName,
    listNotes: async () => store.summaries(),
    readNote: async (id) => store.read(id),
    createNote: () => store.create(),
    duplicateNote: (id) => store.duplicate(id),
    saveNote: (id, body) => store.save(id, body),
    finalizeNote: (id) => store.finalize(id),
    setLabels: (id, labels) => store.setLabels(id, labels),
    setPinned: (id, pinned) => store.setPinned(id, pinned),
    searchNotes: async (query) => store.search(query),

    trashNote: (id) => store.trash(id),
    listTrash: () => store.listTrash(),
    readTrash: (name) => store.readTrash(name),
    restoreFromTrash: (name) => store.restore(name),
    deleteFromTrash: (name) => store.deleteFromTrash(name),

    async saveAsset(bytes, mime) {
      await assetDelay();
      const name = await assetNameFor(bytes, mime);
      if (await fs.writeAsset(name, bytes)) {
        assetUrls.set(name, URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })));
      }
      return `assets/${name}`;
    },
    assetUrl(src) {
      const name = assetNameFromPath(src);
      return name && isImageAssetName(name) ? (assetUrls.get(name) ?? null) : null;
    },
    async saveAttachment(bytes, fileName) {
      await assetDelay();
      if (!isAllowedAttachment(fileName)) throw new Error('Blocked file type.');
      const name = await attachmentNameFor(bytes, fileName);
      await fs.writeAsset(name, bytes);
      return `assets/${name}`;
    },
    async openAttachment(src) {
      attachmentActions.push(`open:${await requireAttachment(src)}`);
    },
    async revealAttachment(src) {
      attachmentActions.push(`reveal:${await requireAttachment(src)}`);
    },

    async exportNote(id, format) {
      const doc = store.read(id);
      const base = slugify(doc.title);
      if (format === 'pdf' || format === 'docx') {
        // PDF and DOCX need the main process (printing, ZIP); browser mode only records the request.
        exports.push({ format, fileName: `${base}.${format}`, content: doc.body });
        return `${base}.${format}`;
      }
      const ext = { wiki: 'txt', markdown: 'md', html: 'html' }[format];
      const fileName = `${base}.${ext}`;
      const content =
        format === 'wiki' ? markdownToWiki(doc.body) : format === 'html' ? markdownToHtmlDocument(doc.body, doc.title) : doc.body;
      exports.push({ format, fileName, content });
      download(fileName, content);
      return fileName;
    },
    async exportAll() {
      for (const note of store.summaries()) {
        exports.push({ format: 'all', fileName: note.fileName, content: store.fileText(note.id) });
      }
      return 'Downloads (Browser-Modus)';
    },
    async importNotes() {
      const files = await pickFiles();
      if (!files) return null;
      return importTexts(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    },
    importTexts,

    listVersions: async (id) => (await store.listVersions(id)).map(({ name, time }) => ({ name, time })),
    async readVersion(id, name) {
      await wait(window.__mdnotesVersionReadDelayMs?.[name] ?? 0);
      return store.readVersion(id, name);
    },
    async restoreVersion(id, name) {
      await wait(window.__mdnotesVersionWriteDelayMs ?? 0);
      return store.restoreVersion(id, name);
    },
    async restoreBlocks(id, body) {
      await wait(window.__mdnotesVersionWriteDelayMs ?? 0);
      return store.restoreBlocks(id, body);
    },
    renameLabel: (from, to) => store.renameLabel(from, to),

    getBackupSettings: async () => settings(),
    async updateBackupSettings(patch) {
      backupSettings = { ...backupSettings, ...patch };
      return settings();
    },
    chooseBackupFolder: async () => settings(),
    async createBackup() {
      const now = Date.now();
      const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const info: BackupInfo = { file: `mdnotes-backup-${stamp}-${backups.length + 1}.zip`, created: now, kind: 'manual', size: 0 };
      const files = new Map(store.summaries().map((n) => [n.fileName, store.fileText(n.id)]));
      info.size = [...files.values()].reduce((sum, text) => sum + text.length, 0);
      backups.unshift({ info, files });
      backups.splice(backupSettings.keep);
      return info;
    },
    listBackups: async () => backups.map((b) => b.info),
    verifyBackup: async (file) => ({ ok: true, files: findBackup(file).files.size, problems: [] }),
    listBackupNotes: async (file) =>
      [...findBackup(file).files.entries()].map(([path, text]) => ({ path, title: titleFromBody(parseNote(text).body) })),
    async restoreBackupNotes(file, paths) {
      const { files } = findBackup(file);
      return importTexts(paths.map((path) => ({ name: file, text: files.get(path) ?? '' })).filter((f) => f.text));
    },
    // Needs a real folder; not available in browser mode.
    restoreBackupToFolder: async () => null,

    async writeRecovery(id, body) {
      recovery.set(id, { body, savedAt: Date.now() });
    },
    async clearRecovery(id) {
      recovery.delete(id);
    },
    async listRecovery() {
      const entries = [];
      for (const [id, { body, savedAt }] of recovery) {
        if (!store.has(id) || store.read(id).body === body) recovery.delete(id);
        else entries.push({ id, title: titleFromBody(body), body, savedAt });
      }
      return entries;
    },

    async getLanguage() {
      const choice = readLanguage();
      return { choice, locale: resolveLocale(choice, navigator.languages) };
    },
    async setLanguage(choice) {
      if (!isLanguageChoice(choice)) throw new Error('Invalid language.');
      try {
        localStorage.setItem(LANGUAGE_KEY, choice);
      } catch {
        // No storage: the choice is lost on reload.
      }
      return { choice, locale: resolveLocale(choice, navigator.languages) };
    },

    async getNoteSort() {
      try {
        const stored = localStorage.getItem(NOTE_SORT_KEY);
        if (isNoteSort(stored)) return stored;
      } catch {
        // Storage blocked.
      }
      return DEFAULT_NOTE_SORT;
    },
    async setNoteSort(sort) {
      if (!isNoteSort(sort)) throw new Error('Invalid sort order.');
      try {
        localStorage.setItem(NOTE_SORT_KEY, sort);
      } catch {
        // No storage: the order only lasts for this session.
      }
      return sort;
    },

    onMenuCommand: noop,
    onFlushRequest: noop,
    onNotesChanged(callback) {
      changeListeners.add(callback);
      return () => changeListeners.delete(callback);
    },
  };
}

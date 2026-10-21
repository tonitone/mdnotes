import type { ExportFormat, ImportReport, NotesApi, NotesChangedEvent } from '../../shared/api';
import { assetNameFor, assetNameFromPath } from '../../shared/assets';
import { MemoryFs } from '../../shared/fs-port';
import { markdownToWiki } from '../../shared/markdown/wiki';
import { newId, serializeNote, slugify } from '../../shared/note';
import { NoteStore } from '../../shared/note-store';

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
  }
}

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

  window.__mdnotesExternalEdit = async (id, body) => {
    const fileName = store.read(id).fileName;
    fs.putExternal(fileName, store.fileText(id).replace(/\n---\n[\s\S]*$/, `\n---\n${body}`));
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
    saveNote: (id, body) => store.save(id, body),
    finalizeNote: (id) => store.finalize(id),
    setLabels: (id, labels) => store.setLabels(id, labels),
    searchNotes: async (query) => store.search(query),

    trashNote: (id) => store.trash(id),
    listTrash: () => store.listTrash(),
    readTrash: (name) => store.readTrash(name),
    restoreFromTrash: (name) => store.restore(name),
    deleteFromTrash: (name) => store.deleteFromTrash(name),

    async saveAsset(bytes, mime) {
      const name = await assetNameFor(bytes, mime);
      if (await fs.writeAsset(name, bytes)) {
        assetUrls.set(name, URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })));
      }
      return `assets/${name}`;
    },
    assetUrl(src) {
      const name = assetNameFromPath(src);
      return name ? (assetUrls.get(name) ?? null) : null;
    },

    async exportNote(id, format) {
      const doc = store.read(id);
      const base = slugify(doc.title);
      if (format === 'pdf') {
        // Printing to PDF needs Electron; browser mode only records the request.
        exports.push({ format, fileName: `${base}.pdf`, content: doc.body });
        return `${base}.pdf`;
      }
      const fileName = `${base}.${format === 'wiki' ? 'txt' : 'md'}`;
      const content = format === 'wiki' ? markdownToWiki(doc.body) : doc.body;
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

    onMenuCommand: noop,
    onFlushRequest: noop,
    onNotesChanged(callback) {
      changeListeners.add(callback);
      return () => changeListeners.delete(callback);
    },
  };
}

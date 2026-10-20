import type { NotesApi } from '../../shared/api';
import { MemoryFs } from '../../shared/fs-port';
import { newId, serializeNote } from '../../shared/note';
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

  return {
    mode: 'browser',
    getWorkspace: async () => workspaceName,
    chooseWorkspace: async () => workspaceName,
    listNotes: async () => store.summaries(),
    readNote: async (id) => store.read(id),
    createNote: () => store.create(),
    saveNote: (id, body) => store.save(id, body),
    finalizeNote: (id) => store.finalize(id),
    onMenuCommand: noop,
    onFlushRequest: noop,
  };
}

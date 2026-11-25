import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NodeFs } from '../../src/main/node-fs';
import { Workspace, isRelevantChange } from '../../src/main/workspace';
import type { NotesChangedEvent } from '../../src/shared/api';
import { MemoryFs, type FsPort } from '../../src/shared/fs-port';
import { parseNote } from '../../src/shared/note';
import { NoteStore } from '../../src/shared/note-store';
import { isScannedPath, isValidRelativePath } from '../../src/shared/workspace-path';

const ID_A = '01JAB3K9ZZ4QWERTYVPASD0001';

interface Backend {
  fs: FsPort;
  /** Puts a file into the workspace as if it came from outside the app. */
  put: (rel: string, text: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/** The same tests run against memory and against the real file system. */
const backends: Array<{ name: string; setup: () => Promise<Backend> }> = [
  {
    name: 'MemoryFs',
    setup: async () => {
      const fs = new MemoryFs(true);
      return { fs, put: async (rel, text) => fs.putExternal(rel, text), cleanup: async () => {} };
    },
  },
  {
    name: 'NodeFs',
    setup: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'mdnotes-nested-'));
      return {
        fs: new NodeFs(dir),
        put: async (rel, text) => {
          const file = path.join(dir, ...rel.split('/'));
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, text);
        },
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    },
  },
];

for (const backend of backends) {
  describe(`Notes in subfolders with ${backend.name}`, () => {
    let b: Backend;
    let store: NoteStore;

    beforeEach(async () => {
      b = await backend.setup();
      store = new NoteStore(b.fs);
    });
    afterEach(() => b.cleanup());

    it('lists notes from subfolders with their relative path', async () => {
      await b.put('oben.md', '# Oben');
      await b.put('projekte/2026/plan.md', '# Plan');
      const notes = await store.scan();
      assert.deepEqual(notes.map((n) => n.fileName).sort(), ['oben.md', 'projekte/2026/plan.md']);
    });

    it('skips hidden folders, root assets and node_modules', async () => {
      await b.put('.git/notiz.md', '# Git');
      await b.put('.obsidian/x.md', '# Versteckt');
      await b.put('assets/liesmich.md', '# Assets');
      await b.put('projekte/node_modules/paket.md', '# Paket');
      await b.put('projekte/assets/bild-notiz.md', '# Unterordner assets');
      const notes = await store.scan();
      assert.deepEqual(notes.map((n) => n.fileName), ['projekte/assets/bild-notiz.md']);
    });

    it('creates new notes in the root', async () => {
      await b.put('projekte/plan.md', '# Plan');
      await store.scan();
      const note = await store.create();
      assert.ok(!note.fileName.includes('/'));
    });

    it('renames a note by its title inside its own folder', async () => {
      await b.put('projekte/alt.md', `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Alt`);
      await store.scan();
      await store.save(ID_A, '# Neuer Titel\n\nText');
      const result = await store.finalize(ID_A);
      assert.match(result.fileName, /^projekte\/neuer-titel--[0-9a-z]{6}\.md$/);
      assert.ok(!(await b.fs.exists('projekte/alt.md')));
      assert.equal(parseNote(await b.fs.read(result.fileName)).meta.id, ID_A);
    });

    it('allows the same slug in two folders', async () => {
      const id = (n: number) => `01JAB3K9ZZ4QWERTYVPASD000${n}`;
      const note = (n: number) => `---\nid: ${id(n)}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Gleich`;
      await b.put('a/x.md', note(1));
      await b.put('b/y.md', note(2));
      await store.scan();
      const one = await store.finalize(id(1));
      const two = await store.finalize(id(2));
      assert.ok(one.fileName.startsWith('a/gleich--'));
      assert.ok(two.fileName.startsWith('b/gleich--'));
    });

    it('trashes a nested note and restores it into the root', async () => {
      await b.put('projekte/plan.md', `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Plan`);
      await store.scan();
      const trashName = await store.trash(ID_A, new Date(1_700_000_000_000));
      assert.equal(trashName, '1700000000000--plan.md');
      assert.ok(!(await b.fs.exists('projekte/plan.md')));
      const restored = await store.restore(trashName);
      assert.equal(restored.fileName, 'plan.md');
      assert.equal(restored.id, ID_A);
    });

    it('gives a copied note with the same ID in another folder its own ID', async () => {
      const text = `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Kopie`;
      await b.put('a/kopie.md', text);
      await b.put('b/kopie.md', text);
      const notes = await store.scan();
      assert.equal(notes.length, 2);
      assert.equal(new Set(notes.map((n) => n.id)).size, 2);
    });

    it('recovers an interrupted rename in a subfolder', async () => {
      await b.put('projekte/.rename-abc123.tmp', '# Gerettet');
      const notes = await store.scan();
      assert.deepEqual(notes.map((n) => n.fileName), ['projekte/wiederhergestellt-abc123.md']);
    });

    it('picks up an outside change in a subfolder', async () => {
      await b.put('projekte/plan.md', `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Plan`);
      await store.scan();
      await b.put('projekte/plan.md', `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Plan geändert`);
      const event = await store.refresh();
      assert.deepEqual(event.changed, [ID_A]);
      assert.equal(store.read(ID_A).title, 'Plan geändert');
    });

    it('rejects paths that leave the workspace', async () => {
      for (const bad of ['../x.md', '/etc/x.md', 'a\\b.md', 'a//b.md', 'a/./b.md', 'a/../b.md']) {
        await assert.rejects(b.fs.create(bad, 'x'), /Invalid file name/, bad);
      }
    });
  });
}

describe('workspace paths', () => {
  it('accepts relative POSIX paths only', () => {
    assert.ok(isValidRelativePath('a/b/c.md'));
    for (const bad of ['', '/a.md', 'C:/a.md', 'a\\b.md', 'a/../b.md', './a.md', 'a//b.md', 'a\0.md']) {
      assert.ok(!isValidRelativePath(bad), bad);
    }
  });

  it('limits the folder depth to 10', () => {
    const folders = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`).join('/');
    assert.ok(isScannedPath(`${folders(10)}/x.md`));
    assert.ok(!isScannedPath(`${folders(11)}/x.md`));
  });
});

describe('NodeFs with subfolders and links', () => {
  let base: string;
  let root: string;
  let outside: string;
  let fs: NodeFs;
  const linksWork = process.platform !== 'win32';

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'mdnotes-links-'));
    root = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    fs = new NodeFs(root);
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  it('ignores folders deeper than 10 levels', async () => {
    const deep = (n: number) => path.join(root, ...Array.from({ length: n }, (_, i) => `d${i}`));
    await mkdir(deep(11), { recursive: true });
    await writeFile(path.join(deep(10), 'ok.md'), '# ok');
    await writeFile(path.join(deep(11), 'zu-tief.md'), '# zu tief');
    const names = await fs.list();
    assert.equal(names.filter((n) => n.endsWith('ok.md')).length, 1);
    assert.equal(names.filter((n) => n.endsWith('zu-tief.md')).length, 0);
  });

  it('writes temp files next to the note in its subfolder and leaves none behind', async () => {
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', 'a.md'), 'alt');
    await fs.writeAtomic('sub/a.md', 'neu');
    assert.deepEqual(await readdir(path.join(root, 'sub')), ['a.md']);
    assert.equal(await readFile(path.join(root, 'sub', 'a.md'), 'utf8'), 'neu');
  });

  it('lists linked files and folders, also outside the workspace', { skip: !linksWork }, async () => {
    await writeFile(path.join(outside, 'fremd.md'), '# Fremd');
    await mkdir(path.join(outside, 'ordner'));
    await writeFile(path.join(outside, 'ordner', 'drin.md'), '# Drin');
    await symlink(path.join(outside, 'fremd.md'), path.join(root, 'fremd.md'));
    await symlink(path.join(outside, 'ordner'), path.join(root, 'verlinkt'));
    assert.deepEqual((await fs.list()).sort(), ['fremd.md', 'verlinkt/drin.md']);
  });

  it('skips broken links and does not hang on link loops', { skip: !linksWork }, async () => {
    await symlink(path.join(outside, 'gibts-nicht.md'), path.join(root, 'kaputt.md'));
    await mkdir(path.join(root, 'a'));
    await writeFile(path.join(root, 'a', 'n.md'), '# n');
    await symlink(path.join(root, 'a'), path.join(root, 'a', 'schleife'));
    await symlink(root, path.join(root, 'a', 'zurueck'));
    assert.deepEqual(await fs.list(), ['a/n.md']);
  });

  it('writes through a link and keeps the link', { skip: !linksWork }, async () => {
    const target = path.join(outside, 'ziel.md');
    await writeFile(target, 'alt');
    await symlink(target, path.join(root, 'link.md'));
    await fs.writeAtomic('link.md', 'neu');
    assert.ok((await lstat(path.join(root, 'link.md'))).isSymbolicLink());
    assert.equal(await readFile(target, 'utf8'), 'neu');
    assert.deepEqual(await readdir(outside), ['ziel.md'], 'no temp file left next to the target');
  });

  it('renames, trashes and restores the link, never the target', { skip: !linksWork }, async () => {
    const target = path.join(outside, 'ziel.md');
    await writeFile(target, `---\nid: ${ID_A}\nlabels: []\ncreated: 2026-01-01T00:00:00.000Z\n---\n# Ziel`);
    await mkdir(path.join(root, 'sub'));
    // A relative link: it must still resolve after moving into another folder.
    await symlink(path.relative(path.join(root, 'sub'), target), path.join(root, 'sub', 'ziel.md'));
    const store = new NoteStore(fs);
    await store.scan();
    await store.save(ID_A, '# Umbenannt');
    const renamed = await store.finalize(ID_A);
    assert.ok((await lstat(path.join(root, ...renamed.fileName.split('/')))).isSymbolicLink());
    assert.deepEqual(await readdir(outside), ['ziel.md']);

    const trashName = await store.trash(ID_A);
    assert.ok((await lstat(path.join(root, '.trash', trashName))).isSymbolicLink());
    assert.match(await readFile(target, 'utf8'), /# Umbenannt/, 'target untouched by trash');

    const restored = await store.restore(trashName);
    const restoredPath = path.join(root, restored.fileName);
    assert.ok((await lstat(restoredPath)).isSymbolicLink());
    assert.equal(path.resolve(root, await readlink(restoredPath)), target);

    await store.trash(ID_A);
    const [entry] = await store.listTrash();
    await store.deleteFromTrash(entry.trashName);
    assert.match(await readFile(target, 'utf8'), /# Umbenannt/, 'deleting from the trash keeps the target');
  });
});

describe('workspace watcher', () => {
  let root: string;
  let ws: Workspace;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mdnotes-watch-'));
    await mkdir(path.join(root, 'projekte'));
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, 'projekte', 'plan.md'), '# Plan');
  });
  afterEach(async () => {
    ws?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('ignores temp files, hidden files and skipped folders', () => {
    assert.ok(isRelevantChange('projekte/plan.md'));
    assert.ok(isRelevantChange('neuer-ordner'));
    assert.ok(!isRelevantChange('projekte/.plan.md.1234abcd.tmp'));
    assert.ok(!isRelevantChange('.git/index'));
    assert.ok(!isRelevantChange('.git/notiz.md'));
    assert.ok(!isRelevantChange('node_modules/x/readme.md'));
    assert.ok(!isRelevantChange('assets/0123456789abcdef.png'));
  });

  it('reports an outside edit in a subfolder', async () => {
    const events: NotesChangedEvent[] = [];
    ws = new Workspace(root, (event) => events.push(event));
    await ws.open();
    const [note] = ws.store.summaries();
    // Give the native watcher a moment to start before writing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(path.join(root, 'projekte', 'plan.md'), '# Plan geändert');
    const deadline = Date.now() + 10_000;
    while (events.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(events.flatMap((e) => e.changed), [note.id]);
  });

  it('notices a note in a folder created after opening', async () => {
    const events: NotesChangedEvent[] = [];
    ws = new Workspace(root, (event) => events.push(event));
    await ws.open();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await mkdir(path.join(root, 'neu'));
    // Wait until the new folder was picked up, then add a note to it.
    const deadline = Date.now() + 10_000;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await writeFile(path.join(root, 'neu', 'spaeter.md'), '# Später');
    while (!ws.store.summaries().some((n) => n.fileName === 'neu/spaeter.md') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ws.store.summaries().some((n) => n.fileName === 'neu/spaeter.md'));
  });
});

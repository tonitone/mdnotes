import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NodeFs } from '../../src/main/node-fs';
import { MemoryFs, type FsPort } from '../../src/shared/fs-port';
import { parseNote } from '../../src/shared/note';
import { NoteStore } from '../../src/shared/note-store';

/** The same tests run against memory and against the real file system. */
const backends: Array<{ name: string; setup: () => Promise<{ fs: FsPort; cleanup: () => Promise<void>; dir?: string }> }> = [
  {
    name: 'MemoryFs (case-insensitive, like macOS/Windows)',
    setup: async () => ({ fs: new MemoryFs(true), cleanup: async () => {} }),
  },
  {
    name: 'MemoryFs (case-sensitive, like Linux)',
    setup: async () => ({ fs: new MemoryFs(false), cleanup: async () => {} }),
  },
  {
    name: 'NodeFs (real file system)',
    setup: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'mdnotes-'));
      return { fs: new NodeFs(dir), dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
    },
  },
];

for (const backend of backends) {
  describe(`NoteStore with ${backend.name}`, () => {
    let fs: FsPort;
    let store: NoteStore;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ fs, cleanup } = await backend.setup());
      store = new NoteStore(fs);
      await store.scan();
    });
    afterEach(() => cleanup());

    it('creates new notes with a unique name and front matter', async () => {
      const a = await store.create();
      const b = await store.create();
      assert.notEqual(a.fileName, b.fileName);
      assert.match(a.fileName, /^neue-notiz--[0-9a-z]{6}\.md$/);
      const parsed = parseNote(await fs.read(a.fileName));
      assert.equal(parsed.meta.id, a.id);
      assert.deepEqual(parsed.meta.labels, []);
    });

    it('saves without renaming and renames only on finalize', async () => {
      const note = await store.create();
      const saved = await store.save(note.id, '# Einkauf Samstag\n\nMilch');
      assert.equal(saved.fileName, note.fileName, 'saving does not rename');
      assert.equal(saved.title, 'Einkauf Samstag');

      const final = await store.finalize(note.id);
      assert.match(final.fileName, /^einkauf-samstag--[0-9a-z]{6}\.md$/);
      assert.ok(!(await fs.exists(note.fileName)), 'old file is gone');
      assert.equal(parseNote(await fs.read(final.fileName)).body, '# Einkauf Samstag\n\nMilch');
    });

    it('never overwrites another note with the same title', async () => {
      const a = await store.create();
      const b = await store.create();
      await store.save(a.id, '# Gleich');
      await store.save(b.id, '# Gleich');
      const fa = await store.finalize(a.id);
      const fb = await store.finalize(b.id);
      assert.notEqual(fa.fileName, fb.fileName);
      assert.equal(parseNote(await fs.read(fa.fileName)).meta.id, a.id);
      assert.equal(parseNote(await fs.read(fb.fileName)).meta.id, b.id);
    });

    it('renames correctly when only the case changes', async () => {
      const note = await store.create();
      await store.save(note.id, '# abc');
      const first = await store.finalize(note.id);
      // The slug stays the same, but we simulate an upper-case name set from outside.
      const upper = first.fileName.toUpperCase().replace('.MD', '.md');
      await fs.rename(first.fileName, upper);
      await store.scan();
      const final = await store.finalize(note.id);
      assert.equal(final.fileName, first.fileName);
      const names = (await fs.list()).filter((n) => n.endsWith('.md'));
      assert.deepEqual(names, [first.fileName]);
    });

    it('avoids a foreign file with the desired name', async () => {
      const note = await store.create();
      await store.save(note.id, '# Konflikt');
      const desired = `konflikt--${note.id.slice(-6).toLowerCase()}.md`;
      await fs.create(desired, 'fremder Inhalt');
      const final = await store.finalize(note.id);
      assert.equal(final.fileName, desired.replace('.md', '-2.md'));
      assert.equal(await fs.read(desired), 'fremder Inhalt');
    });

    it('assigns missing IDs and writes them on save', async () => {
      await fs.create('importiert.md', '# Von außen\nText');
      const [summary] = await store.scan();
      assert.equal(summary.fileName, 'importiert.md');
      assert.equal(parseNote(await fs.read('importiert.md')).meta.id, undefined, 'scan does not write');
      const final = await store.finalize(summary.id);
      assert.equal(parseNote(await fs.read(final.fileName)).meta.id, summary.id);
      assert.equal(parseNote(await fs.read(final.fileName)).body, '# Von außen\nText');
    });

    it('separates copied files with the same ID', async () => {
      const note = await store.create();
      await store.save(note.id, '# Original');
      await fs.create('kopie.md', await fs.read(note.fileName));
      const list = await store.scan();
      assert.equal(list.length, 2);
      assert.equal(new Set(list.map((n) => n.id)).size, 2);
    });

    it('keeps foreign front matter lines on save', async () => {
      await fs.create('fremd.md', '---\nauthor: Toni\ntags: [x]\n---\n# Fremd');
      const [summary] = await store.scan();
      await store.save(summary.id, '# Fremd geändert');
      const text = await fs.read(summary.fileName);
      assert.match(text, /author: Toni/);
      assert.match(text, /tags: \[x\]/);
    });

    it('ignores hidden and temp files', async () => {
      await fs.create('.versteckt.md', 'x');
      await fs.create('notiz.txt', 'x');
      const list = await store.scan();
      assert.equal(list.length, 0);
    });

    it('recovers an interrupted rename', async () => {
      await fs.create('.rename-abc123.tmp', '# Gerettet');
      const list = await store.scan();
      assert.equal(list.length, 1);
      assert.equal(list[0].title, 'Gerettet');
    });

    it('serializes concurrent calls', async () => {
      const note = await store.create();
      const results = await Promise.all([
        store.save(note.id, '# Eins'),
        store.finalize(note.id),
        store.save(note.id, '# Zwei'),
        store.finalize(note.id),
      ]);
      assert.equal(results[3].title, 'Zwei');
      assert.match(results[3].fileName, /^zwei--/);
      assert.equal(parseNote(await fs.read(results[3].fileName)).body, '# Zwei');
    });

    it('sets normalized labels and counts them', async () => {
      const a = await store.create();
      const b = await store.create();
      const summary = await store.setLabels(a.id, [' Arbeit ', 'arbeit', 'a,b', 'Idee']);
      assert.deepEqual(summary.labels, ['Arbeit', 'a b', 'Idee']);
      await store.setLabels(b.id, ['idee']);
      assert.deepEqual(parseNote(await fs.read(a.fileName)).meta.labels, ['Arbeit', 'a b', 'Idee']);
      assert.deepEqual(store.labels(), [
        { label: 'a b', count: 1 },
        { label: 'Arbeit', count: 1 },
        { label: 'Idee', count: 2 },
      ]);
    });

    it('searches title and body, ignoring case and diacritics', async () => {
      const a = await store.create();
      const b = await store.create();
      await store.save(a.id, '# Einkauf\n\nMilch und Käse vom Markt');
      await store.save(b.id, '# Kase-Rezept\n\nNichts zu sehen');
      assert.deepEqual(store.search('kase').map((h) => h.id), [b.id, a.id]);
      assert.deepEqual(store.search('MILCH markt').map((h) => h.id), [a.id]);
      assert.match(store.search('markt')[0].snippet, /Käse vom Markt/);
      assert.deepEqual(store.search('   '), []);
    });

    it('moves notes to the trash and restores them', async () => {
      const note = await store.create();
      await store.save(note.id, '# Weg');
      await store.finalize(note.id);
      await store.trash(note.id, new Date(Date.UTC(2026, 9, 1)));
      assert.equal(store.summaries().length, 0);

      const [entry] = await store.listTrash();
      assert.equal(entry.title, 'Weg');
      assert.equal(entry.trashedAt, Date.UTC(2026, 9, 1));
      assert.equal(await store.readTrash(entry.trashName), '# Weg');

      const restored = await store.restore(entry.trashName);
      assert.equal(restored.id, note.id);
      assert.equal(restored.title, 'Weg');
      assert.deepEqual(await store.listTrash(), []);
    });

    it('restores next to a file with the same name without overwriting it', async () => {
      const note = await store.create();
      await store.trash(note.id);
      await fs.create(note.fileName, 'fremd');
      const [entry] = await store.listTrash();
      const restored = await store.restore(entry.trashName);
      assert.notEqual(restored.fileName, note.fileName);
      assert.equal(await fs.read(note.fileName), 'fremd');
    });

    it('purges only trash entries older than the retention period', async () => {
      const old = await store.create();
      const recent = await store.create();
      await store.trash(old.id, new Date(Date.UTC(2026, 0, 1)));
      await store.trash(recent.id, new Date(Date.UTC(2026, 9, 15)));
      assert.equal(await store.purgeTrash(undefined, new Date(Date.UTC(2026, 9, 20))), 1);
      assert.equal((await store.listTrash()).length, 1);
    });

    it('deletes trash entries permanently', async () => {
      const note = await store.create();
      await store.trash(note.id);
      const [entry] = await store.listTrash();
      await store.deleteFromTrash(entry.trashName);
      assert.deepEqual(await store.listTrash(), []);
    });

    it('imports notes, records the source and skips duplicates', async () => {
      const first = await store.importNote('---\nauthor: x\n---\n# Import\n\nText', 'alt.md');
      assert.ok(first);
      assert.match(first!.fileName, /^import--[0-9a-z]{6}\.md$/);
      const text = await fs.read(first!.fileName);
      assert.match(text, /author: x/);
      assert.match(text, /source: "alt.md"/);
      assert.equal(await store.importNote('# Import\n\nText\n', 'kopie.md'), null);
    });

    it('gives an imported note a new ID if its ID is already used', async () => {
      const note = await store.create();
      const imported = await store.importNote(await fs.read(note.fileName) + 'anders', 'x.md');
      assert.ok(imported);
      assert.notEqual(imported!.id, note.id);
    });

    it('stores assets once per content', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      assert.equal(await fs.writeAsset('0123456789abcdef.png', bytes), true);
      assert.equal(await fs.writeAsset('0123456789abcdef.png', bytes), false);
      assert.deepEqual([...(await fs.readAsset('0123456789abcdef.png'))], [1, 2, 3]);
    });

    it('refresh reports outside changes but not our own writes', async () => {
      const a = await store.create();
      await store.save(a.id, '# A');
      await store.finalize(a.id);
      assert.deepEqual(await store.refresh(), { changed: [], removed: [], added: [] });

      const fileName = store.read(a.id).fileName;
      await fs.writeAtomic(fileName, (await fs.read(fileName)).replace('# A', '# A geändert'));
      await fs.create('neu.md', '# Neu');
      const event = await store.refresh();
      assert.deepEqual(event.changed, [a.id]);
      assert.equal(event.added.length, 1);
      assert.equal(store.read(a.id).title, 'A geändert');
      assert.deepEqual(await store.refresh(), { changed: [], removed: [], added: [] });
    });

    it('refresh reports files deleted outside the app', async () => {
      const a = await store.create();
      await fs.moveToTrash(a.fileName, '1--x.md');
      assert.deepEqual(await store.refresh(), { changed: [], removed: [a.id], added: [] });
    });

    it('keeps the ID of a file without front matter across refreshes', async () => {
      await fs.create('ohne.md', '# Ohne');
      const [summary] = await store.scan();
      await fs.writeAtomic('ohne.md', '# Ohne geändert');
      const event = await store.refresh();
      assert.deepEqual(event.changed, [summary.id]);
    });
  });
}

describe('NodeFs safety', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdnotes-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('rejects paths outside the workspace', async () => {
    const fs = new NodeFs(dir);
    await assert.rejects(fs.read('../etc/passwd'), /Invalid file name/);
    await assert.rejects(fs.create('sub/x.md', ''), /Invalid file name/);
  });

  it('leaves no temp files after an atomic write', async () => {
    const fs = new NodeFs(dir);
    await writeFile(path.join(dir, 'a.md'), 'alt');
    await fs.writeAtomic('a.md', 'neu');
    assert.equal(await readFile(path.join(dir, 'a.md'), 'utf8'), 'neu');
    assert.deepEqual(await readdir(dir), ['a.md']);
  });

  it('create never overwrites', async () => {
    const fs = new NodeFs(dir);
    await fs.create('a.md', 'eins');
    await assert.rejects(fs.create('a.md', 'zwei'), { code: 'EEXIST' });
    assert.equal(await fs.read('a.md'), 'eins');
  });
});

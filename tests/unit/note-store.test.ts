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

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NodeFs } from '../../src/main/node-fs';
import { MemoryFs, type FsPort } from '../../src/shared/fs-port';
import { parseVersionName, selectVersionsToKeep, VersionStore } from '../../src/shared/history';
import { NoteStore } from '../../src/shared/note-store';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

describe('selectVersionsToKeep', () => {
  it('keeps everything from the last 24 hours', () => {
    const times = [NOW - 1, NOW - HOUR, NOW - 23 * HOUR];
    assert.deepEqual([...selectVersionsToKeep(times, NOW)].sort(), [...times].sort());
  });

  it('keeps the newest version per day up to 30 days', () => {
    const dayAgo2 = NOW - 2 * DAY;
    const times = [dayAgo2 + HOUR, dayAgo2, dayAgo2 - HOUR, NOW - 10 * DAY, NOW - 10 * DAY - HOUR];
    const keep = selectVersionsToKeep(times, NOW);
    assert.ok(keep.has(dayAgo2 + HOUR));
    assert.ok(!keep.has(dayAgo2));
    assert.ok(keep.has(NOW - 10 * DAY));
    assert.ok(!keep.has(NOW - 10 * DAY - HOUR));
  });

  it('keeps the newest version per week after 30 days', () => {
    const base = Date.UTC(2026, 6, 6); // a Monday, ~3.5 months ago
    const times = [base + 3 * DAY, base + 2 * DAY, base, base - DAY];
    const keep = selectVersionsToKeep(times, NOW);
    assert.ok(keep.has(base + 3 * DAY)); // newest of that week
    assert.ok(!keep.has(base + 2 * DAY));
    assert.ok(!keep.has(base));
    assert.ok(keep.has(base - DAY)); // Sunday belongs to the previous week
  });

  it('always keeps the newest version, however old', () => {
    assert.deepEqual([...selectVersionsToKeep([NOW - 400 * DAY], NOW)], [NOW - 400 * DAY]);
  });
});

describe('parseVersionName', () => {
  it('accepts only well-formed names', () => {
    assert.deepEqual(parseVersionName('1761048000000-0123abcd.md'), { name: '1761048000000-0123abcd.md', time: 1761048000000, hash: '0123abcd' });
    assert.equal(parseVersionName('../x.md'), null);
    assert.equal(parseVersionName('1761048000000-0123ABCD.md'), null);
  });
});

const backends: Array<{ name: string; setup: () => Promise<{ fs: FsPort; cleanup: () => Promise<void>; dir?: string }> }> = [
  { name: 'MemoryFs', setup: async () => ({ fs: new MemoryFs(true), cleanup: async () => {} }) },
  {
    name: 'NodeFs',
    setup: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'mdnotes-history-'));
      return { fs: new NodeFs(dir), dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
    },
  },
];

for (const backend of backends) {
  describe(`versions with ${backend.name}`, () => {
    let fs: FsPort;
    let store: NoteStore;
    let cleanup: () => Promise<void>;
    let dir: string | undefined;

    beforeEach(async () => {
      ({ fs, cleanup, dir } = await backend.setup());
      store = new NoteStore(fs);
      await store.scan();
    });
    afterEach(() => cleanup());

    it('snapshots on finalize and skips unchanged content', async () => {
      const note = await store.create();
      await store.save(note.id, '# Eins');
      await store.finalize(note.id);
      await store.finalize(note.id);
      await store.save(note.id, '# Zwei');
      await store.finalize(note.id);
      const versions = await store.listVersions(note.id);
      assert.equal(versions.length, 2);
      assert.equal(await store.readVersion(note.id, versions[0].name), '# Zwei');
      assert.equal(await store.readVersion(note.id, versions[1].name), '# Eins');
    });

    it('does not version empty notes', async () => {
      const note = await store.create();
      await store.finalize(note.id);
      assert.deepEqual(await store.listVersions(note.id), []);
    });

    it('restores an old version and keeps the current one', async () => {
      const note = await store.create();
      await store.save(note.id, '# Alt');
      await store.finalize(note.id);
      await store.save(note.id, '# Neu');
      await store.finalize(note.id);
      const old = (await store.listVersions(note.id)).find((v) => v.name)!;
      const oldest = (await store.listVersions(note.id)).at(-1)!;
      assert.notEqual(old.name, oldest.name);

      const restored = await store.restoreVersion(note.id, oldest.name);
      assert.equal(restored.body, '# Alt');
      assert.equal(restored.title, 'Alt');
      const versions = await store.listVersions(note.id);
      assert.equal(versions.length, 3);
      assert.equal(await store.readVersion(note.id, versions[0].name), '# Alt');
      assert.equal(await store.readVersion(note.id, versions[1].name), '# Neu');
    });

    it('keeps the previous content as a version when the file changes outside', async () => {
      const note = await store.create();
      await store.save(note.id, '# Vorher');
      const fileName = store.read(note.id).fileName;
      await fs.writeAtomic(fileName, (await fs.read(fileName)).replace('# Vorher', '# Nachher'));
      await store.refresh();
      const [version] = await store.listVersions(note.id);
      assert.equal(await store.readVersion(note.id, version.name), '# Vorher');
    });

    it('removes the history when a note is deleted from the trash', async () => {
      const note = await store.create();
      await store.save(note.id, '# Weg');
      await store.finalize(note.id);
      await store.trash(note.id);
      const [entry] = await store.listTrash();
      await store.deleteFromTrash(entry.trashName);
      assert.deepEqual(await fs.listHistory(note.id), []);
      if (dir) assert.deepEqual(await readdir(path.join(dir, '.history')), []);
    });

    it('prunes old versions with the retention rules', async () => {
      const note = await store.create();
      const versions = new VersionStore(fs);
      for (let i = 0; i < 5; i++) {
        await versions.snapshot(note.id, `# V${i}`, new Date(NOW - 40 * DAY + i * HOUR));
      }
      await versions.snapshot(note.id, '# Jetzt', new Date(NOW));
      const names = await versions.list(note.id);
      assert.equal(names.length, 2);
      assert.equal(await versions.read(note.id, names[1].name), '# V4');
    });

    it('rejects invalid IDs and version names', async () => {
      if (!dir) return;
      await assert.rejects(fs.readHistory('../../etc', '1761048000000-0123abcd.md'), /Invalid note ID/);
      await assert.rejects(fs.readHistory('01JAB3K9ZZ4QWERTYVPASD1234', '../x.md'), /Invalid version name/);
    });
  });
}

describe('renameLabel', () => {
  it('renames in all notes and merges with an existing label', async () => {
    const store = new NoteStore(new MemoryFs());
    await store.scan();
    const a = await store.create();
    const b = await store.create();
    await store.setLabels(a.id, ['Projekt', 'Idee']);
    await store.setLabels(b.id, ['projekt', 'Arbeit']);
    const changed = await store.renameLabel('projekt', 'Arbeit');
    assert.equal(changed.length, 2);
    assert.deepEqual(store.read(a.id).labels, ['Arbeit', 'Idee']);
    assert.deepEqual(store.read(b.id).labels, ['Arbeit']);
    await assert.rejects(store.renameLabel('Arbeit', '  '), /Invalid label/);
  });
});

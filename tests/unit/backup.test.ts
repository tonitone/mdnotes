import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  assertBackupFolder,
  backupNotes,
  createBackup,
  isDailyBackupDue,
  listBackups,
  restoreNotes,
  restoreToFolder,
  verifyBackup,
} from '../../src/main/backup';
import { NodeFs } from '../../src/main/node-fs';
import { createZip, readZip, ZipError } from '../../src/main/zip';
import { NoteStore } from '../../src/shared/note-store';

describe('zip', () => {
  it('round-trips entries', () => {
    const entries = [
      { path: 'a.md', data: Buffer.from('# A\n') },
      { path: 'assets/0123456789abcdef.png', data: new Uint8Array([0, 1, 2, 255]) },
      { path: 'leer.md', data: new Uint8Array() },
      { path: 'ümlaut.md', data: Buffer.from('ä') },
    ];
    const back = readZip(createZip(entries));
    assert.deepEqual(
      back.map((e) => [e.path, Buffer.from(e.data).toString('hex')]),
      entries.map((e) => [e.path, Buffer.from(e.data).toString('hex')]),
    );
  });

  it('rejects unsafe paths when writing and reading', () => {
    for (const bad of ['../x', '/abs', 'a/../b', 'C:/x', 'a\\b', '']) {
      assert.throws(() => createZip([{ path: bad, data: new Uint8Array() }]), ZipError, bad);
    }
    // Craft an archive with a zip-slip path by patching a valid one.
    const zip = createZip([{ path: 'xx/evil.md', data: Buffer.from('x') }]);
    const patched = Buffer.from(zip.toString('latin1').replaceAll('xx/evil.md', '../evil.md'), 'latin1');
    assert.throws(() => readZip(patched), /Unsafe path/);
  });

  it('detects corruption', () => {
    const zip = createZip([{ path: 'a.md', data: Buffer.from('hello world, hello world') }]);
    const corrupt = Buffer.from(zip);
    corrupt[40] ^= 0xff; // inside the compressed data
    assert.throws(() => readZip(corrupt));
    assert.throws(() => readZip(Buffer.from('no zip')), /Not a ZIP/);
  });
});

describe('backup', () => {
  let root: string;
  let workspace: string;
  let folder: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mdnotes-backup-'));
    workspace = path.join(root, 'ws');
    folder = path.join(root, 'backups');
    await mkdir(path.join(workspace, 'assets'), { recursive: true });
    await writeFile(path.join(workspace, 'eins.md'), '# Eins\n\n![Bild](assets/0123456789abcdef.png)\n');
    await writeFile(path.join(workspace, 'zwei.md'), '# Zwei\n');
    await writeFile(path.join(workspace, '.versteckt.md'), 'x');
    await writeFile(path.join(workspace, 'assets', '0123456789abcdef.png'), Buffer.from([1, 2, 3]));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('creates a verified backup with a manifest', async () => {
    const info = await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 10 });
    assert.match(info.file, /^mdnotes-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/);
    const check = await verifyBackup(folder, info.file);
    assert.deepEqual(check, { ok: true, files: 3, problems: [] });
    assert.deepEqual(
      (await backupNotes(folder, info.file)).map((n) => n.title),
      ['Eins', 'Zwei'],
    );
  });

  it('includes the version history only when asked', async () => {
    const store = new NoteStore(new NodeFs(workspace));
    await store.scan();
    const note = await store.create();
    await store.save(note.id, '# Mit Historie');
    await store.finalize(note.id);
    const without = await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 10, now: new Date(2026, 0, 1) });
    const withHistory = await createBackup(workspace, folder, { kind: 'manual', includeHistory: true, keep: 10, now: new Date(2026, 0, 2) });
    const count = async (file: string) => readZip(await readFile(path.join(folder, file))).filter((e) => e.path.startsWith('.history/')).length;
    assert.equal(await count(without.file), 0);
    assert.equal(await count(withHistory.file), 1);
  });

  it('refuses a backup folder inside the workspace', async () => {
    assert.throws(() => assertBackupFolder(workspace, path.join(workspace, 'backups')), /nicht im Workspace/);
    assert.throws(() => assertBackupFolder(workspace, workspace), /nicht im Workspace/);
    assert.doesNotThrow(() => assertBackupFolder(workspace, folder));
  });

  it('keeps only the newest backups and never reuses a name', async () => {
    const now = new Date(2026, 9, 21, 12, 0, 0);
    for (let i = 0; i < 4; i++) {
      await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 3, now: new Date(now.getTime() + i * 1000) });
    }
    await createBackup(workspace, folder, { kind: 'safety', includeHistory: false, keep: 3, now: new Date(now.getTime() + 4000) });
    const list = await listBackups(folder);
    assert.equal(list.length, 3);
    assert.equal(list[0].kind, 'safety');
    assert.equal((await readdir(folder)).filter((f) => f.endsWith('.tmp')).length, 0);
  });

  it('reports damaged backups', async () => {
    const info = await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 10 });
    const file = path.join(folder, info.file);
    const bytes = await readFile(file);
    bytes[45] ^= 0xff;
    await writeFile(file, bytes);
    const check = await verifyBackup(folder, info.file);
    assert.equal(check.ok, false);
    assert.ok(check.problems.length > 0);
  });

  it('restores single notes with their images, without overwriting', async () => {
    const info = await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 10 });
    const target = path.join(root, 'other');
    await mkdir(target);
    const fs = new NodeFs(target);
    const store = new NoteStore(fs);
    await store.scan();
    const report = await restoreNotes(store, fs, folder, info.file, ['eins.md']);
    assert.deepEqual(report, { imported: 1, skipped: 0, warnings: [] });
    assert.deepEqual([...(await fs.readAsset('0123456789abcdef.png'))], [1, 2, 3]);
    assert.deepEqual(await restoreNotes(store, fs, folder, info.file, ['eins.md']), { imported: 0, skipped: 1, warnings: [] });
  });

  it('restores a whole backup only into an empty folder', async () => {
    const info = await createBackup(workspace, folder, { kind: 'manual', includeHistory: false, keep: 10 });
    const target = path.join(root, 'restored');
    await restoreToFolder(folder, info.file, target);
    assert.deepEqual((await readdir(target)).sort(), ['assets', 'eins.md', 'zwei.md']);
    await assert.rejects(restoreToFolder(folder, info.file, target), /nicht leer/);
  });

  it('rejects invalid backup names', async () => {
    await assert.rejects(restoreToFolder(folder, '../evil.zip', path.join(root, 'x')), /Invalid backup name/);
  });

  it('knows when the daily backup is due', () => {
    const now = new Date(2026, 9, 21, 12);
    assert.equal(isDailyBackupDue([], now), true);
    assert.equal(isDailyBackupDue([{ file: 'a', kind: 'auto', size: 1, created: now.getTime() - 3_600_000 }], now), false);
    assert.equal(isDailyBackupDue([{ file: 'a', kind: 'safety', size: 1, created: now.getTime() - 3_600_000 }], now), true);
    assert.equal(isDailyBackupDue([{ file: 'a', kind: 'manual', size: 1, created: now.getTime() - 25 * 3_600_000 }], now), true);
  });
});

describe('recovery', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdnotes-recovery-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('offers only unsaved content of existing notes and cleans up the rest', async () => {
    const { RecoveryStore } = await import('../../src/main/recovery');
    const { MemoryFs } = await import('../../src/shared/fs-port');
    const store = new NoteStore(new MemoryFs());
    await store.scan();
    const a = await store.create();
    const b = await store.create();
    await store.save(a.id, '# Gespeichert');
    await store.save(b.id, '# B');
    const recovery = new RecoveryStore(path.join(dir, 'recovery'));
    await recovery.write(a.id, '# Gespeichert und mehr');
    await recovery.write(b.id, '# B');
    await recovery.write('01JAB3K9ZZ4QWERTYVPASD1234', '# Gelöscht');

    const entries = await recovery.list(store);
    assert.deepEqual(entries.map((e) => [e.id, e.title]), [[a.id, 'Gespeichert und mehr']]);
    assert.deepEqual(await readdir(path.join(dir, 'recovery')), [`${a.id}.md`]);
    await recovery.clear(a.id);
    assert.deepEqual(await recovery.list(store), []);
    await assert.rejects(recovery.write('../x', 'y'), /Invalid note ID/);
  });
});

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BackupInfo, BackupKind, ImportReport } from '../shared/api';
import { ASSET_DIR, isAssetName, referencedAssets } from '../shared/assets';
import { HISTORY_DIR, VERSION_NAME_RE } from '../shared/history';
import { isNoteId, parseNote, titleFromBody } from '../shared/note';
import type { NoteStore } from '../shared/note-store';
import type { NodeFs } from './node-fs';
import { createZip, readZip, type ZipEntry } from './zip';

/**
 * Backups of a workspace as ZIP files with a manifest of SHA-256 checksums.
 * Pure Node code (no Electron), so it can be unit tested.
 */

export const MANIFEST = 'manifest.json';
const NAME_RE = /^mdnotes-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(auto|safety))?(?:-\d+)?\.zip$/;

export interface BackupManifest {
  app: 'mdnotes';
  schema: 1;
  created: string;
  kind: BackupKind;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export function isBackupName(name: string): boolean {
  return NAME_RE.test(name) && name === path.basename(name);
}

function parseName(name: string): { created: number; kind: BackupKind } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, kind] = m;
  return { created: new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), kind: (kind as BackupKind | undefined) ?? 'manual' };
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** True if `child` is `parent` or inside it. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertBackupFolder(workspace: string, folder: string): void {
  if (isInside(workspace, folder)) throw new Error('Der Backup-Ordner darf nicht im Workspace liegen.');
}

async function readDirSafe(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Notes, images and (optionally) the version history of a workspace. */
export async function collectWorkspace(root: string, includeHistory: boolean): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const add = async (rel: string) => {
    const file = path.join(root, ...rel.split('/'));
    const stat = await fsp.stat(file);
    entries.push({ path: rel, data: new Uint8Array(await fsp.readFile(file)), mtime: stat.mtime });
  };
  for (const e of await readDirSafe(root)) {
    if (e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase().endsWith('.md')) await add(e.name);
  }
  for (const e of await readDirSafe(path.join(root, ASSET_DIR))) {
    if (e.isFile() && isAssetName(e.name)) await add(`${ASSET_DIR}/${e.name}`);
  }
  if (includeHistory) {
    for (const d of await readDirSafe(path.join(root, HISTORY_DIR))) {
      if (!d.isDirectory() || !isNoteId(d.name)) continue;
      for (const e of await readDirSafe(path.join(root, HISTORY_DIR, d.name))) {
        if (e.isFile() && VERSION_NAME_RE.test(e.name)) await add(`${HISTORY_DIR}/${d.name}/${e.name}`);
      }
    }
  }
  return entries;
}

function backupName(now: Date, kind: BackupKind): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `mdnotes-backup-${stamp}${kind === 'manual' ? '' : `-${kind}`}.zip`;
}

/** Reads a backup and checks every file against the manifest. */
export async function readBackup(folder: string, name: string): Promise<{ manifest: BackupManifest; files: Map<string, Uint8Array> }> {
  if (!isBackupName(name)) throw new Error(`Invalid backup name: ${name}`);
  const entries = readZip(await fsp.readFile(path.join(folder, name)));
  const files = new Map(entries.map((e) => [e.path, e.data]));
  const raw = files.get(MANIFEST);
  if (!raw) throw new Error('Manifest fehlt.');
  const manifest = JSON.parse(Buffer.from(raw).toString('utf8')) as BackupManifest;
  if (manifest.app !== 'mdnotes' || manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error('Unbekanntes Backup-Format.');
  files.delete(MANIFEST);
  return { manifest, files };
}

export async function verifyBackup(folder: string, name: string): Promise<{ ok: boolean; files: number; problems: string[] }> {
  const problems: string[] = [];
  try {
    const { manifest, files } = await readBackup(folder, name);
    for (const f of manifest.files) {
      const data = files.get(f.path);
      if (!data) problems.push(`Fehlt: ${f.path}`);
      else if (data.byteLength !== f.size || sha256(data) !== f.sha256) problems.push(`Beschädigt: ${f.path}`);
    }
    for (const p of files.keys()) {
      if (!manifest.files.some((f) => f.path === p)) problems.push(`Nicht im Manifest: ${p}`);
    }
    return { ok: problems.length === 0, files: manifest.files.length, problems };
  } catch (err) {
    return { ok: false, files: 0, problems: [(err as Error).message] };
  }
}

export async function listBackups(folder: string): Promise<BackupInfo[]> {
  const result: BackupInfo[] = [];
  for (const e of await readDirSafe(folder)) {
    const info = e.isFile() ? parseName(e.name) : null;
    if (!info) continue;
    const { size } = await fsp.stat(path.join(folder, e.name));
    result.push({ file: e.name, created: info.created, kind: info.kind, size });
  }
  return result.sort((a, b) => b.created - a.created || b.file.localeCompare(a.file));
}

/** Keeps the newest `keep` backups and deletes the rest. Returns how many were deleted. */
export async function pruneBackups(folder: string, keep: number): Promise<number> {
  const old = (await listBackups(folder)).slice(Math.max(1, keep));
  for (const b of old) await fsp.rm(path.join(folder, b.file), { force: true });
  return old.length;
}

export async function createBackup(
  workspace: string,
  folder: string,
  options: { kind: BackupKind; includeHistory: boolean; keep: number; now?: Date },
): Promise<BackupInfo> {
  assertBackupFolder(workspace, folder);
  await fsp.mkdir(folder, { recursive: true });
  const now = options.now ?? new Date();
  const entries = await collectWorkspace(workspace, options.includeHistory);
  const manifest: BackupManifest = {
    app: 'mdnotes',
    schema: 1,
    created: now.toISOString(),
    kind: options.kind,
    files: entries.map((e) => ({ path: e.path, size: e.data.byteLength, sha256: sha256(e.data) })),
  };
  const zip = createZip([...entries, { path: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)), mtime: now }]);

  // Unique name, written to a temp file first so a crash never leaves a half backup.
  const base = backupName(now, options.kind);
  let name = base;
  for (let n = 2; (await readDirSafe(folder)).some((e) => e.name === name); n++) name = base.replace(/\.zip$/, `-${n}.zip`);
  const temp = path.join(folder, `.${name}.tmp`);
  await fsp.writeFile(temp, zip, { flag: 'wx' });
  await fsp.rename(temp, path.join(folder, name));

  const check = await verifyBackup(folder, name);
  if (!check.ok) throw new Error(`Backup ist fehlerhaft: ${check.problems.join(', ')}`);
  await pruneBackups(folder, options.keep);
  return { file: name, created: now.getTime(), kind: options.kind, size: zip.length };
}

/** Notes contained in a backup, for picking single notes to restore. */
export async function backupNotes(folder: string, name: string): Promise<Array<{ path: string; title: string }>> {
  const { files } = await readBackup(folder, name);
  return [...files.entries()]
    .filter(([p]) => !p.includes('/') && p.toLowerCase().endsWith('.md'))
    .map(([p, data]) => ({ path: p, title: titleFromBody(parseNote(Buffer.from(data).toString('utf8')).body) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Restores single notes into the open workspace. Never overwrites: identical
 * notes are skipped, changed ones come back as a copy. Images come along.
 */
export async function restoreNotes(store: NoteStore, fs: NodeFs, folder: string, name: string, paths: string[]): Promise<ImportReport> {
  const { files } = await readBackup(folder, name);
  const report: ImportReport = { imported: 0, skipped: 0, warnings: [] };
  for (const p of paths) {
    const data = files.get(p);
    if (!data || p.includes('/')) {
      report.warnings.push(`${p}: nicht im Backup gefunden.`);
      continue;
    }
    const text = Buffer.from(data).toString('utf8');
    for (const asset of referencedAssets(text)) {
      const bytes = files.get(`${ASSET_DIR}/${asset}`);
      if (bytes) await fs.writeAsset(asset, bytes);
      else report.warnings.push(`${p}: Bild ${asset} fehlt im Backup.`);
    }
    if (await store.importNote(text, name)) report.imported++;
    else report.skipped++;
  }
  return report;
}

/** Extracts a whole backup into an empty (or new) folder. */
export async function restoreToFolder(folder: string, name: string, target: string): Promise<void> {
  const { files } = await readBackup(folder, name);
  if ((await readDirSafe(target)).length > 0) throw new Error('Der Zielordner ist nicht leer.');
  await fsp.mkdir(target, { recursive: true });
  for (const [p, data] of files) {
    const file = path.resolve(target, ...p.split('/'));
    if (!isInside(target, file)) throw new Error(`Unsafe path in backup: ${p}`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data, { flag: 'wx' });
  }
}

export function isDailyBackupDue(backups: BackupInfo[], now: Date = new Date()): boolean {
  const latest = backups.find((b) => b.kind !== 'safety');
  return !latest || now.getTime() - latest.created >= 24 * 60 * 60 * 1000;
}

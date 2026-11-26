import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { ASSET_DIR, isAssetName } from '../shared/assets';

/**
 * One rule for every place that touches `assets/` (saving, reusing a stored
 * file with the same content, opening, revealing, reading for export): the
 * folder must be a real folder inside the workspace, not a link, and every
 * entry must be a regular file, not a link, folder or device. A planted link
 * can then never make the app write, reuse, open or export a file elsewhere.
 * Runs in the main process only.
 */

export class AssetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetPolicyError';
  }
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * `<root>/assets` after checking it, or `null` if it does not exist and
 * `create` is false. With `create`, a missing folder is created first.
 */
export async function assetDir(root: string, options: { create: boolean }): Promise<string | null> {
  const dir = path.join(root, ASSET_DIR);
  let info;
  try {
    info = await fsp.lstat(dir);
  } catch (err) {
    if (!isMissing(err)) throw err;
    if (!options.create) return null;
    try {
      await fsp.mkdir(dir);
    } catch (mkdirErr) {
      if ((mkdirErr as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirErr;
    }
    info = await fsp.lstat(dir);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new AssetPolicyError('The assets folder is a link or not a folder.');
  // The workspace itself may be reached through a link; the assets folder must still lie inside it.
  const [realRoot, realDir] = await Promise.all([fsp.realpath(root), fsp.realpath(dir)]);
  if (realDir !== path.join(realRoot, ASSET_DIR)) throw new AssetPolicyError('The assets folder lies outside the workspace.');
  return realDir;
}

/** The checked path of a stored asset, or `null` if it (or the folder) does not exist. */
export async function assetFile(root: string, name: string): Promise<string | null> {
  if (!isAssetName(name)) throw new AssetPolicyError(`Invalid asset name: ${name}`);
  const dir = await assetDir(root, { create: false });
  if (!dir) return null;
  const file = path.join(dir, name);
  let info;
  try {
    info = await fsp.lstat(file);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  if (!info.isFile()) throw new AssetPolicyError(`Not a regular file: ${ASSET_DIR}/${name}`);
  return file;
}

/**
 * Stores an asset under its content-addressed name. Returns false when a file
 * with that name already exists (same name, same content), after checking that
 * the existing entry is a regular file.
 */
export async function writeAssetFile(root: string, name: string, bytes: Uint8Array): Promise<boolean> {
  if (!isAssetName(name)) throw new AssetPolicyError(`Invalid asset name: ${name}`);
  const dir = (await assetDir(root, { create: true }))!;
  try {
    await fsp.writeFile(path.join(dir, name), bytes, { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  // Deduplication hit: only reuse a regular file, never a link or folder that happens to have the name.
  await assetFile(root, name);
  return false;
}

/** Reads a stored asset through the same checks. Throws if it is missing. */
export async function readAssetFile(root: string, name: string): Promise<Uint8Array> {
  const file = await assetFile(root, name);
  if (!file) throw new Error(`File not found: ${ASSET_DIR}/${name}`);
  return new Uint8Array(await fsp.readFile(file));
}

/**
 * Copies stored assets into `<targetDir>/assets/` for an export. Missing files and
 * files the policy refuses are left out; the export itself goes on.
 */
export async function copyAssetFiles(root: string, names: string[], targetDir: string): Promise<string[]> {
  const copied: string[] = [];
  if (names.length === 0) return copied;
  const target = path.join(targetDir, ASSET_DIR);
  await fsp.mkdir(target, { recursive: true });
  for (const name of names) {
    let source: string | null;
    try {
      source = await assetFile(root, name);
    } catch (err) {
      if (err instanceof AssetPolicyError) continue;
      throw err;
    }
    if (!source) continue;
    try {
      await fsp.copyFile(source, path.join(target, name), constants.COPYFILE_EXCL);
      copied.push(name);
    } catch (err) {
      // EEXIST: same name means same content. ENOENT: removed meanwhile, keep exporting.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOENT') throw err;
    }
  }
  return copied;
}

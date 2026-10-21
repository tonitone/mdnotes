import { randomBytes } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { ASSET_DIR, isAssetName } from '../shared/assets';
import { FileExistsError, type FsPort } from '../shared/fs-port';

export const TRASH_DIR = '.trash';

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * On Windows, virus scanners, search indexers and sync tools briefly lock
 * freshly written files, so renames fail with EPERM/EACCES/EBUSY. Retry with
 * a short backoff (the same approach as graceful-fs).
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRY_CODES.has(code) || attempt >= 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** Math.min(attempt, 5)));
    }
  }
}

/**
 * `FsPort` on the real file system, restricted to one workspace folder.
 * Runs in the main process only, never in the renderer.
 */
export class NodeFs implements FsPort {
  constructor(readonly root: string) {}

  /** Rejects paths outside the workspace (e.g. "../" or subfolders). */
  private resolve(name: string, dir = ''): string {
    if (!name || name !== path.basename(name) || name === '.' || name === '..' || name.includes('\0')) {
      throw new Error(`Invalid file name: ${name}`);
    }
    return path.join(this.root, dir, name);
  }

  private async pathExists(file: string): Promise<boolean> {
    try {
      await fsp.access(file, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const entries = await fsp.readdir(this.root, { withFileTypes: true });
    // Return names unchanged (including NFD umlauts from macOS) so they can
    // be found again on any file system. Our own file names are plain ASCII
    // anyway (see slugify).
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  }

  async read(name: string): Promise<string> {
    return fsp.readFile(this.resolve(name), 'utf8');
  }

  async mtime(name: string): Promise<number> {
    return (await fsp.stat(this.resolve(name))).mtimeMs;
  }

  async exists(name: string): Promise<boolean> {
    return this.pathExists(this.resolve(name));
  }

  async create(name: string, text: string): Promise<void> {
    try {
      // "wx": fails if the file exists. Never overwrite.
      await fsp.writeFile(this.resolve(name), text, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new FileExistsError(name);
      throw err;
    }
  }

  async writeAtomic(name: string, text: string): Promise<void> {
    const target = this.resolve(name);
    const temp = path.join(this.root, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
    const handle = await fsp.open(temp, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync(); // Flush to disk first, then rename.
    } finally {
      await handle.close();
    }
    try {
      await renameWithRetry(temp, target);
    } catch (err) {
      await fsp.rm(temp, { force: true });
      throw err;
    }
  }

  /** Renames without ever replacing another file. */
  private async move(source: string, target: string, sameFile: boolean, targetName: string): Promise<void> {
    if (!sameFile && (await this.pathExists(target))) throw new FileExistsError(targetName);
    await renameWithRetry(source, target);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.move(this.resolve(from), this.resolve(to), from.toLowerCase() === to.toLowerCase(), to);
  }

  async listTrash(): Promise<string[]> {
    try {
      const entries = await fsp.readdir(path.join(this.root, TRASH_DIR), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readTrash(trashName: string): Promise<string> {
    return fsp.readFile(this.resolve(trashName, TRASH_DIR), 'utf8');
  }

  async moveToTrash(name: string, trashName: string): Promise<void> {
    await fsp.mkdir(path.join(this.root, TRASH_DIR), { recursive: true });
    await this.move(this.resolve(name), this.resolve(trashName, TRASH_DIR), false, trashName);
  }

  async restoreFromTrash(trashName: string, name: string): Promise<void> {
    await this.move(this.resolve(trashName, TRASH_DIR), this.resolve(name), false, name);
  }

  async deleteFromTrash(trashName: string): Promise<void> {
    await fsp.rm(this.resolve(trashName, TRASH_DIR));
  }

  async writeAsset(name: string, bytes: Uint8Array): Promise<boolean> {
    if (!isAssetName(name)) throw new Error(`Invalid asset name: ${name}`);
    await fsp.mkdir(path.join(this.root, ASSET_DIR), { recursive: true });
    try {
      await fsp.writeFile(this.resolve(name, ASSET_DIR), bytes, { flag: 'wx' });
      return true;
    } catch (err) {
      // Same name means same content (content-addressed), so nothing to do.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  async readAsset(name: string): Promise<Uint8Array> {
    if (!isAssetName(name)) throw new Error(`Invalid asset name: ${name}`);
    return new Uint8Array(await fsp.readFile(this.resolve(name, ASSET_DIR)));
  }
}

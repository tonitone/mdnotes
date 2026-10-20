import { randomBytes } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { FileExistsError, type FsPort } from '../shared/fs-port';

/**
 * `FsPort` on the real file system, restricted to one workspace folder.
 * Runs in the main process only, never in the renderer.
 */
export class NodeFs implements FsPort {
  constructor(private readonly root: string) {}

  /** Rejects paths outside the workspace (e.g. "../" or subfolders). */
  private resolve(name: string): string {
    if (!name || name !== path.basename(name) || name === '.' || name === '..') {
      throw new Error(`Invalid file name: ${name}`);
    }
    return path.join(this.root, name);
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
    try {
      await fsp.access(this.resolve(name), constants.F_OK);
      return true;
    } catch {
      return false;
    }
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
      await fsp.rename(temp, target);
    } catch (err) {
      await fsp.rm(temp, { force: true });
      throw err;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.resolve(from);
    const target = this.resolve(to);
    const sameFile = from.toLowerCase() === to.toLowerCase();
    if (!sameFile && (await this.exists(to))) throw new FileExistsError(to);
    await fsp.rename(source, target);
  }
}

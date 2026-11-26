import { randomBytes } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { FileExistsError, type FsPort } from '../shared/fs-port';
import { readAssetFile, writeAssetFile } from './asset-policy';
import { HISTORY_DIR, VERSION_NAME_RE } from '../shared/history';
import { isNoteId } from '../shared/note';
import { MAX_FOLDER_DEPTH, isSkippedDir, isValidRelativePath } from '../shared/workspace-path';

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
 *
 * Notes may lie in subfolders and may be symbolic links, also to files or
 * folders outside the workspace. The link itself always lives inside the
 * workspace: writing goes to the link's target and keeps the link, renaming
 * and moving to the trash move the link, never the target.
 */
export class NodeFs implements FsPort {
  /** Absolute paths of the folders the last `list()` scanned (for the watcher on Linux). */
  scannedDirs: string[] = [];

  constructor(readonly root: string) {}

  /**
   * Turns a workspace-relative note path into an absolute path. This is a
   * security boundary: every segment is checked and the result must stay
   * inside the workspace.
   */
  private resolve(rel: string): string {
    if (typeof rel !== 'string' || !isValidRelativePath(rel)) throw new Error(`Invalid file name: ${rel}`);
    const file = path.join(this.root, ...rel.split('/'));
    const inside = path.relative(this.root, file);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`Invalid file name: ${rel}`);
    return file;
  }

  /** A plain file name inside one of the app's folders (`.trash/`, `assets/`). */
  private resolveIn(dir: string, name: string): string {
    if (!name || name !== path.basename(name) || name === '.' || name === '..' || name.includes('\0') || name.includes('/')) {
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

  /** True if anything (also a broken link) is at `file`. */
  private async entryExists(file: string): Promise<boolean> {
    try {
      await fsp.lstat(file);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const result: string[] = [];
    // Real paths of folders already scanned: a folder reached twice (through
    // a link, or a link loop) is scanned only once.
    const visited = new Set<string>();
    const dirs: string[] = [];
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      let real: string;
      try {
        real = await fsp.realpath(dir);
      } catch (err) {
        if (depth === 0) throw err;
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      dirs.push(dir);
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (depth === 0) throw err;
        return; // An unreadable subfolder does not stop the scan.
      }
      // Names stay unchanged (including NFD umlauts from macOS) so they can
      // be found again on any file system. Our own file names are plain
      // ASCII anyway (see slugify). Folders are read one after another, so
      // a large workspace never opens an unbounded number of handles.
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const child = path.join(dir, entry.name);
        let isFile = entry.isFile();
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            const stat = await fsp.stat(child);
            isFile = stat.isFile();
            isDir = stat.isDirectory();
          } catch {
            continue; // Broken link: skipped silently.
          }
        }
        if (isFile) result.push(childRel);
        else if (isDir && depth < MAX_FOLDER_DEPTH && !isSkippedDir(entry.name, depth)) await walk(child, childRel, depth + 1);
      }
    };
    await walk(this.root, '', 0);
    this.scannedDirs = dirs;
    return result;
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
    // Through a link: write next to the real file and replace that one, so
    // the link stays a link and the temp file is on the target's volume.
    let target = this.resolve(name);
    try {
      target = await fsp.realpath(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
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

  /**
   * Moves without ever replacing another file. A link is moved as a link; if
   * it points somewhere relative to its own folder and changes folders, it
   * is recreated with a target that still resolves to the same file.
   */
  private async move(source: string, target: string, sameFile: boolean, targetName: string): Promise<void> {
    if (!sameFile && (await this.entryExists(target))) throw new FileExistsError(targetName);
    if (!sameFile && path.dirname(source) !== path.dirname(target) && (await fsp.lstat(source)).isSymbolicLink()) {
      const link = await fsp.readlink(source);
      if (!path.isAbsolute(link)) {
        const real = path.resolve(path.dirname(source), link);
        try {
          await fsp.symlink(path.relative(path.dirname(target), real), target);
          await fsp.rm(source);
          return;
        } catch (err) {
          // Creating links needs extra rights on Windows: fall back to a plain move.
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') throw new FileExistsError(targetName);
          if (code !== 'EPERM' && code !== 'EACCES') throw err;
        }
      }
    }
    await renameWithRetry(source, target);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.move(this.resolve(from), this.resolve(to), from.toLowerCase() === to.toLowerCase(), to);
  }

  async listTrash(): Promise<string[]> {
    try {
      const entries = await fsp.readdir(path.join(this.root, TRASH_DIR), { withFileTypes: true });
      return entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readTrash(trashName: string): Promise<string> {
    return fsp.readFile(this.resolveIn(TRASH_DIR, trashName), 'utf8');
  }

  async moveToTrash(name: string, trashName: string): Promise<void> {
    await fsp.mkdir(path.join(this.root, TRASH_DIR), { recursive: true });
    await this.move(this.resolve(name), this.resolveIn(TRASH_DIR, trashName), false, trashName);
  }

  async restoreFromTrash(trashName: string, name: string): Promise<void> {
    await this.move(this.resolveIn(TRASH_DIR, trashName), this.resolve(name), false, name);
  }

  async deleteFromTrash(trashName: string): Promise<void> {
    await fsp.rm(this.resolveIn(TRASH_DIR, trashName));
  }

  /** Same name means same content (content-addressed). The checks live in asset-policy.ts. */
  async writeAsset(name: string, bytes: Uint8Array): Promise<boolean> {
    return writeAssetFile(this.root, name, bytes);
  }

  async readAsset(name: string): Promise<Uint8Array> {
    return readAssetFile(this.root, name);
  }

  private historyDir(id: string): string {
    if (!isNoteId(id)) throw new Error(`Invalid note ID: ${id}`);
    return path.join(this.root, HISTORY_DIR, id);
  }

  private historyFile(id: string, name: string): string {
    if (!VERSION_NAME_RE.test(name)) throw new Error(`Invalid version name: ${name}`);
    return path.join(this.historyDir(id), name);
  }

  async listHistory(id: string): Promise<string[]> {
    try {
      const entries = await fsp.readdir(this.historyDir(id), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readHistory(id: string, name: string): Promise<string> {
    return fsp.readFile(this.historyFile(id, name), 'utf8');
  }

  async writeHistory(id: string, name: string, text: string): Promise<void> {
    const file = this.historyFile(id, name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    try {
      await fsp.writeFile(file, text, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  async deleteHistory(id: string, name: string): Promise<void> {
    await fsp.rm(this.historyFile(id, name), { force: true });
  }

  async deleteAllHistory(id: string): Promise<void> {
    await fsp.rm(this.historyDir(id), { recursive: true, force: true });
  }
}

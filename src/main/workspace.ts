import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { NotesChangedEvent } from '../shared/api';
import { NoteStore } from '../shared/note-store';
import { baseName, isScannedPath } from '../shared/workspace-path';
import { NodeFs } from './node-fs';

const WATCH_DEBOUNCE_MS = 300;

/**
 * True if a change at `rel` (workspace-relative, `/` separators) may concern a
 * note: a Markdown file, or a new or renamed folder, outside skipped folders.
 * Temp files and hidden files are ignored.
 */
export function isRelevantChange(rel: string): boolean {
  const name = baseName(rel);
  if (!name || name.startsWith('.') || !isScannedPath(rel)) return false;
  return name.toLowerCase().endsWith('.md') || !name.includes('.');
}

/**
 * An open workspace folder: the note store on top of the real file system,
 * plus a watcher that reports changes made outside the app.
 */
export class Workspace {
  readonly fs: NodeFs;
  readonly store: NoteStore;
  private watcher: FSWatcher | null = null;
  /** Linux: one watcher per scanned folder, keyed by absolute path. */
  private dirWatchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    readonly root: string,
    private readonly onChange: (event: NotesChangedEvent) => void,
  ) {
    this.fs = new NodeFs(root);
    this.store = new NoteStore(this.fs);
  }

  async open(): Promise<void> {
    await this.store.scan();
    await this.store.purgeTrash();
    this.startWatching();
  }

  private startWatching(): void {
    // Notes may live in subfolders. macOS and Windows watch a whole tree
    // natively. On Linux, Node's recursive watch adds a watch for every
    // folder, including .git and node_modules, which can exhaust the inotify
    // limit, so there each scanned folder gets its own watcher instead.
    if (process.platform === 'linux') {
      this.syncDirWatchers();
      return;
    }
    try {
      this.watcher = watch(this.root, { persistent: false, recursive: true }, (_event, filename) => {
        const name = filename?.toString();
        this.onFsEvent(name ? name.split(path.sep).join('/') : undefined);
      });
      this.watcher.on('error', (err) => console.error('Workspace watcher failed:', err));
    } catch (err) {
      // Some network drives do not support watching. The app still works,
      // outside changes then show up when the window regains focus.
      console.error('Could not watch workspace:', err);
    }
  }

  /** Linux: watch exactly the folders the last scan visited. */
  private syncDirWatchers(): void {
    if (this.closed) return;
    const wanted = new Set(this.fs.scannedDirs);
    for (const [dir, watcher] of this.dirWatchers) {
      if (!wanted.has(dir)) {
        watcher.close();
        this.dirWatchers.delete(dir);
      }
    }
    for (const dir of wanted) {
      if (this.dirWatchers.has(dir)) continue;
      const rel = path.relative(this.root, dir).split(path.sep).join('/');
      try {
        const watcher = watch(dir, { persistent: false }, (_event, filename) => {
          const name = filename?.toString();
          this.onFsEvent(name ? (rel && !rel.startsWith('..') ? `${rel}/${name}` : name) : undefined);
        });
        watcher.on('error', () => {
          watcher.close();
          this.dirWatchers.delete(dir);
        });
        this.dirWatchers.set(dir, watcher);
      } catch (err) {
        console.error('Could not watch folder:', dir, err);
      }
    }
  }

  private onFsEvent(rel: string | undefined): void {
    if (rel && !isRelevantChange(rel)) return;
    this.refreshSoon();
  }

  /**
   * Re-reads the workspace shortly. Also called when the window regains
   * focus: watchers do not see edits to link targets outside the workspace.
   */
  refreshSoon(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
  }

  private async refresh(): Promise<void> {
    try {
      const event = await this.store.refresh();
      if (process.platform === 'linux') this.syncDirWatchers();
      if (event.changed.length || event.removed.length || event.added.length) this.onChange(event);
    } catch (err) {
      console.error('Refreshing workspace failed:', err);
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
    for (const watcher of this.dirWatchers.values()) watcher.close();
    this.dirWatchers.clear();
  }
}

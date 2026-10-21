import { watch, type FSWatcher } from 'node:fs';
import type { NotesChangedEvent } from '../shared/api';
import { NoteStore } from '../shared/note-store';
import { NodeFs } from './node-fs';

const WATCH_DEBOUNCE_MS = 300;

/**
 * An open workspace folder: the note store on top of the real file system,
 * plus a watcher that reports changes made outside the app.
 */
export class Workspace {
  readonly fs: NodeFs;
  readonly store: NoteStore;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | undefined;

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
    try {
      // Notes live directly in the workspace, so a non-recursive watch is
      // enough and works the same on macOS, Windows and Linux.
      this.watcher = watch(this.root, { persistent: false }, (_event, filename) => {
        const name = filename?.toString();
        if (name && (name.startsWith('.') || !name.toLowerCase().endsWith('.md'))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
      });
      this.watcher.on('error', (err) => console.error('Workspace watcher failed:', err));
    } catch (err) {
      // Some network drives do not support watching. The app still works,
      // outside changes then show up after the next restart.
      console.error('Could not watch workspace:', err);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const event = await this.store.refresh();
      if (event.changed.length || event.removed.length || event.added.length) this.onChange(event);
    } catch (err) {
      console.error('Refreshing workspace failed:', err);
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { RecoveryEntry } from '../shared/api';
import { isNoteId, titleFromBody } from '../shared/note';
import type { NoteStore } from '../shared/note-store';

/**
 * Crash recovery: the renderer writes unsaved editor content here every few
 * seconds. Files live in the app profile, outside the workspace, so sync
 * tools never pick them up. After a successful save the file is removed.
 */
export class RecoveryStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!isNoteId(id)) throw new Error(`Invalid note ID: ${id}`);
    return path.join(this.dir, `${id}.md`);
  }

  async write(id: string, body: string): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const target = this.file(id);
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(temp, body, 'utf8');
    await fsp.rename(temp, target);
  }

  async clear(id: string): Promise<void> {
    await fsp.rm(this.file(id), { force: true });
  }

  /**
   * Unsaved content that differs from what is on disk. Files that match the
   * saved note, or whose note no longer exists, are cleaned up.
   */
  async list(store: NoteStore): Promise<RecoveryEntry[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const result: RecoveryEntry[] = [];
    for (const name of names) {
      const id = name.replace(/\.md$/, '');
      if (!name.endsWith('.md') || !isNoteId(id)) continue;
      const file = this.file(id);
      const body = await fsp.readFile(file, 'utf8');
      if (!store.has(id) || store.read(id).body === body) {
        await fsp.rm(file, { force: true });
        continue;
      }
      result.push({ id, title: titleFromBody(body), body, savedAt: (await fsp.stat(file)).mtimeMs });
    }
    return result;
  }
}

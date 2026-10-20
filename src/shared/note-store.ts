import type { NoteDoc, NoteSummary, SaveResult } from './api';
import { FileExistsError, type FsPort } from './fs-port';
import {
  UNTITLED,
  fileNameFor,
  newId,
  parseNote,
  previewFromBody,
  serializeNote,
  titleFromBody,
  type NoteMeta,
} from './note';

interface Entry {
  fileName: string;
  meta: NoteMeta;
  extraFrontMatter: string[];
  body: string;
  title: string;
  preview: string;
  modified: number;
  /** The ID exists only in memory and is written to the file on the next save. */
  idPending: boolean;
}

/** Skips files that are not notes: hidden files, temp files. */
function isNoteFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md') && !name.startsWith('.');
}

/**
 * Manages the notes of a workspace through any `FsPort`.
 *
 * A note's identity is its ID in the front matter. The file name follows the
 * title and is only updated in `finalize()`, so the file is not renamed on
 * every keystroke.
 */
export class NoteStore {
  private entries = new Map<string, Entry>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly fs: FsPort) {}

  /** Runs operations one after another so saving and renaming never overlap. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  scan(): Promise<NoteSummary[]> {
    return this.serial(async () => {
      this.entries.clear();
      await this.recoverInterruptedRenames();
      const names = (await this.fs.list()).filter(isNoteFile).sort();
      for (const fileName of names) {
        const parsed = parseNote(await this.fs.read(fileName));
        let id = parsed.meta.id;
        let idPending = false;
        // Missing ID or a copy of another note: assign a new ID.
        if (!id || this.entries.has(id)) {
          id = newId();
          idPending = true;
        }
        const modified = await this.fs.mtime(fileName);
        this.entries.set(id, {
          fileName,
          meta: {
            id,
            labels: parsed.meta.labels ?? [],
            created: parsed.meta.created ?? new Date(modified).toISOString(),
          },
          extraFrontMatter: parsed.extraFrontMatter,
          body: parsed.body,
          title: titleFromBody(parsed.body),
          preview: previewFromBody(parsed.body),
          modified,
          idPending,
        });
      }
      return this.summaries();
    });
  }

  summaries(): NoteSummary[] {
    return [...this.entries.entries()]
      .map(([id, e]) => this.summary(id, e))
      .sort((a, b) => b.modified - a.modified);
  }

  private summary(id: string, e: Entry): NoteSummary {
    return {
      id,
      fileName: e.fileName,
      title: e.title,
      preview: e.preview,
      labels: e.meta.labels,
      modified: e.modified,
    };
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown note: ${id}`);
    return e;
  }

  read(id: string): NoteDoc {
    const e = this.entry(id);
    return { ...this.summary(id, e), body: e.body, created: e.meta.created };
  }

  create(now: Date = new Date()): Promise<NoteDoc> {
    return this.serial(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newId(now.getTime());
        const meta: NoteMeta = { id, labels: [], created: now.toISOString() };
        const fileName = fileNameFor(UNTITLED, id);
        try {
          await this.fs.create(fileName, serializeNote(meta, ''));
        } catch (err) {
          if (err instanceof FileExistsError || (err as { code?: string }).code === 'EEXIST') continue;
          throw err;
        }
        this.entries.set(id, {
          fileName,
          meta,
          extraFrontMatter: [],
          body: '',
          title: UNTITLED,
          preview: '',
          modified: await this.fs.mtime(fileName),
          idPending: false,
        });
        return this.read(id);
      }
      throw new Error('Could not find a free file name.');
    });
  }

  save(id: string, body: string): Promise<SaveResult> {
    return this.serial(async () => {
      const e = this.entry(id);
      await this.fs.writeAtomic(e.fileName, serializeNote(e.meta, body, e.extraFrontMatter));
      e.body = body;
      e.title = titleFromBody(body);
      e.preview = previewFromBody(body);
      e.modified = await this.fs.mtime(e.fileName);
      e.idPending = false;
      return this.result(id, e);
    });
  }

  finalize(id: string): Promise<SaveResult> {
    return this.serial(async () => {
      const e = this.entry(id);
      if (e.idPending) {
        await this.fs.writeAtomic(e.fileName, serializeNote(e.meta, e.body, e.extraFrontMatter));
        e.idPending = false;
      }
      const desired = fileNameFor(e.title, id);
      if (desired !== e.fileName) {
        e.fileName = await this.renameTo(e.fileName, desired);
        e.modified = await this.fs.mtime(e.fileName);
      }
      return this.result(id, e);
    });
  }

  /** If a two-step rename was interrupted, make the file visible again. */
  private async recoverInterruptedRenames(): Promise<void> {
    for (const name of await this.fs.list()) {
      if (!/^\.rename-[a-z0-9]+\.tmp$/.test(name)) continue;
      let target = `wiederhergestellt-${name.slice(8, -4)}.md`;
      for (let n = 2; await this.fs.exists(target); n++) {
        target = target.replace(/(-\d+)?\.md$/, `-${n}.md`);
      }
      await this.fs.rename(name, target);
    }
  }

  private async renameTo(current: string, desired: string): Promise<string> {
    // Only the case changed: go through a temporary name, because a direct
    // rename is not reliable on macOS and Windows.
    if (current.toLowerCase() === desired.toLowerCase()) {
      const temp = `.rename-${Date.now().toString(36)}.tmp`;
      await this.fs.rename(current, temp);
      await this.fs.rename(temp, desired);
      return desired;
    }
    // Target taken (e.g. by a foreign file): append a counter, never overwrite.
    let target = desired;
    for (let n = 2; await this.fs.exists(target); n++) {
      target = desired.replace(/\.md$/, `-${n}.md`);
    }
    await this.fs.rename(current, target);
    return target;
  }

  private result(id: string, e: Entry): SaveResult {
    return { id, fileName: e.fileName, title: e.title, preview: e.preview, modified: e.modified };
  }
}

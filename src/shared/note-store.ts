import type { NoteDoc, NoteSummary, NotesChangedEvent, SaveResult, SearchHit, TrashEntry } from './api';
import { FileExistsError, type FsPort } from './fs-port';
import {
  UNTITLED,
  fileNameFor,
  isNoteId,
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
  /** File content as last read or written by us; used to detect outside changes. */
  text: string;
}

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LABEL_LENGTH = 40;

/** Skips files that are not notes: hidden files, temp files. */
function isNoteFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md') && !name.startsWith('.');
}

function isExists(err: unknown): boolean {
  return err instanceof FileExistsError || (err as { code?: string }).code === 'EEXIST';
}

/** Trims labels, removes characters that break the front matter list, drops duplicates. */
export function normalizeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw
      .replace(/[,[\]"'#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LABEL_LENGTH)
      .trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

/** Lower case without diacritics, same length as the input (for snippet positions). */
function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const base = ch.normalize('NFKD')[0] ?? ch;
    out += base.toLowerCase().length === ch.length ? base.toLowerCase() : ch;
  }
  return out;
}

function makeSnippet(body: string, term: string): string {
  const plain = body.replace(/[#>*_`~[\]()!|-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const at = fold(plain).indexOf(term);
  if (at === -1) return previewFromBody(body);
  const start = Math.max(0, at - 40);
  const end = Math.min(plain.length, at + term.length + 80);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

function parseTrashName(trashName: string): { trashedAt: number; fileName: string } | null {
  const m = /^(\d{10,})--(.+\.md)$/i.exec(trashName);
  return m ? { trashedAt: Number(m[1]), fileName: m[2] } : null;
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

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private async load(fileName: string, text: string, preferredId?: string): Promise<{ id: string; entry: Entry }> {
    const parsed = parseNote(text);
    let id = parsed.meta.id;
    let idPending = false;
    // Missing ID or a copy of another note: assign a new ID.
    if (!id || (this.entries.has(id) && id !== preferredId)) {
      id = preferredId && !this.entries.has(preferredId) ? preferredId : newId();
      idPending = true;
    }
    const modified = await this.fs.mtime(fileName);
    return {
      id,
      entry: {
        fileName,
        meta: { id, labels: parsed.meta.labels ?? [], created: parsed.meta.created ?? new Date(modified).toISOString() },
        extraFrontMatter: parsed.extraFrontMatter,
        body: parsed.body,
        title: titleFromBody(parsed.body),
        preview: previewFromBody(parsed.body),
        modified,
        idPending,
        text,
      },
    };
  }

  scan(): Promise<NoteSummary[]> {
    return this.serial(async () => {
      this.entries.clear();
      await this.recoverInterruptedRenames();
      const names = (await this.fs.list()).filter(isNoteFile).sort();
      for (const fileName of names) {
        const { id, entry } = await this.load(fileName, await this.fs.read(fileName));
        this.entries.set(id, entry);
      }
      return this.summaries();
    });
  }

  /**
   * Re-reads the workspace after outside changes. Files we wrote ourselves
   * (same content as last written) are not reported.
   */
  refresh(): Promise<NotesChangedEvent> {
    return this.serial(async () => {
      const event: NotesChangedEvent = { changed: [], removed: [], added: [] };
      const byFile = new Map<string, string>();
      for (const [id, e] of this.entries) byFile.set(e.fileName, id);
      const seen = new Set<string>();

      for (const fileName of (await this.fs.list()).filter(isNoteFile)) {
        const text = await this.fs.read(fileName);
        const knownId = byFile.get(fileName);
        if (knownId) {
          seen.add(knownId);
          if (this.entries.get(knownId)!.text === text) continue;
          this.entries.delete(knownId);
          const { id, entry } = await this.load(fileName, text, knownId);
          this.entries.set(id, entry);
          seen.add(id);
          if (id === knownId) {
            event.changed.push(id);
          } else {
            event.removed.push(knownId);
            event.added.push(id);
          }
        } else {
          const { id, entry } = await this.load(fileName, text);
          this.entries.set(id, entry);
          seen.add(id);
          event.added.push(id);
        }
      }

      for (const id of [...this.entries.keys()]) {
        if (!seen.has(id)) {
          this.entries.delete(id);
          event.removed.push(id);
        }
      }
      return event;
    });
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  summaries(): NoteSummary[] {
    return [...this.entries.entries()]
      .map(([id, e]) => this.summary(id, e))
      .sort((a, b) => b.modified - a.modified);
  }

  private summary(id: string, e: Entry): NoteSummary {
    return { id, fileName: e.fileName, title: e.title, preview: e.preview, labels: e.meta.labels, modified: e.modified };
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown note: ${id}`);
    return e;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  read(id: string): NoteDoc {
    const e = this.entry(id);
    return { ...this.summary(id, e), body: e.body, created: e.meta.created };
  }

  /** The complete file content (front matter and body), e.g. for exports. */
  fileText(id: string): string {
    const e = this.entry(id);
    return serializeNote(e.meta, e.body, e.extraFrontMatter);
  }

  search(query: string): SearchHit[] {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits: Array<SearchHit & { score: number; modified: number }> = [];
    for (const [id, e] of this.entries) {
      const title = fold(e.title);
      const haystack = `${title}\n${fold(e.body)}`;
      if (!terms.every((t) => haystack.includes(t))) continue;
      const score = terms.filter((t) => title.includes(t)).length;
      hits.push({ id, snippet: makeSnippet(e.body, terms[0]), score, modified: e.modified });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.modified - a.modified)
      .map(({ id, snippet }) => ({ id, snippet }));
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /** Finds a free file name: `name.md`, `name-2.md`, `name-3.md`, … */
  private async uniqueName(desired: string): Promise<string> {
    let target = desired;
    for (let n = 2; await this.fs.exists(target); n++) target = desired.replace(/\.md$/i, `-${n}.md`);
    return target;
  }

  private async write(id: string, e: Entry): Promise<void> {
    const text = serializeNote(e.meta, e.body, e.extraFrontMatter);
    await this.fs.writeAtomic(e.fileName, text);
    e.text = text;
    e.idPending = false;
    e.modified = await this.fs.mtime(e.fileName);
    this.entries.set(id, e);
  }

  /** Creates a file that must not exist yet, retrying with a counter on collisions. */
  private async createFile(desired: string, text: string): Promise<string> {
    let target = desired;
    for (let n = 2; n < 1000; n++) {
      try {
        await this.fs.create(target, text);
        return target;
      } catch (err) {
        if (!isExists(err)) throw err;
        target = desired.replace(/\.md$/i, `-${n}.md`);
      }
    }
    throw new Error('Could not find a free file name.');
  }

  create(now: Date = new Date()): Promise<NoteDoc> {
    return this.serial(async () => {
      const id = newId(now.getTime());
      const meta: NoteMeta = { id, labels: [], created: now.toISOString() };
      const text = serializeNote(meta, '');
      const fileName = await this.createFile(fileNameFor(UNTITLED, id), text);
      this.entries.set(id, {
        fileName,
        meta,
        extraFrontMatter: [],
        body: '',
        title: UNTITLED,
        preview: '',
        modified: await this.fs.mtime(fileName),
        idPending: false,
        text,
      });
      return this.read(id);
    });
  }

  save(id: string, body: string): Promise<SaveResult> {
    return this.serial(async () => {
      const e = this.entry(id);
      e.body = body;
      e.title = titleFromBody(body);
      e.preview = previewFromBody(body);
      await this.write(id, e);
      return this.result(id, e);
    });
  }

  finalize(id: string): Promise<SaveResult> {
    return this.serial(async () => {
      const e = this.entry(id);
      if (e.idPending) await this.write(id, e);
      const desired = fileNameFor(e.title, id);
      if (desired !== e.fileName) {
        e.fileName = await this.renameTo(e.fileName, desired);
        e.modified = await this.fs.mtime(e.fileName);
      }
      return this.result(id, e);
    });
  }

  setLabels(id: string, labels: string[]): Promise<NoteSummary> {
    return this.serial(async () => {
      const e = this.entry(id);
      e.meta = { ...e.meta, labels: normalizeLabels(labels) };
      await this.write(id, e);
      return this.summary(id, e);
    });
  }

  /** All labels with the number of notes using them, sorted by name. */
  labels(): Array<{ label: string; count: number }> {
    const counts = new Map<string, { label: string; count: number }>();
    for (const e of this.entries.values()) {
      for (const label of e.meta.labels) {
        const key = label.toLocaleLowerCase();
        const item = counts.get(key) ?? { label, count: 0 };
        item.count++;
        counts.set(key, item);
      }
    }
    return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Imports a Markdown file as a new note. Returns `null` if a note with the
   * same content already exists. Foreign front matter is kept, the original
   * file name is recorded as `source`.
   */
  importNote(text: string, sourceName: string, now: Date = new Date()): Promise<NoteSummary | null> {
    return this.serial(async () => {
      const parsed = parseNote(text);
      const body = parsed.body;
      for (const e of this.entries.values()) {
        if (e.body.trim() === body.trim()) return null;
      }
      const id = parsed.meta.id && isNoteId(parsed.meta.id) && !this.entries.has(parsed.meta.id) ? parsed.meta.id : newId(now.getTime());
      const extra = [...parsed.extraFrontMatter];
      if (!extra.some((l) => /^source:/.test(l))) extra.push(`source: ${JSON.stringify(sourceName)}`);
      const meta: NoteMeta = {
        id,
        labels: normalizeLabels(parsed.meta.labels ?? []),
        created: parsed.meta.created ?? now.toISOString(),
      };
      const fileText = serializeNote(meta, body, extra);
      const title = titleFromBody(body);
      const fileName = await this.createFile(fileNameFor(title, id), fileText);
      const entry: Entry = {
        fileName,
        meta,
        extraFrontMatter: extra,
        body,
        title,
        preview: previewFromBody(body),
        modified: await this.fs.mtime(fileName),
        idPending: false,
        text: fileText,
      };
      this.entries.set(id, entry);
      return this.summary(id, entry);
    });
  }

  // -------------------------------------------------------------------------
  // Trash
  // -------------------------------------------------------------------------

  trash(id: string, now: Date = new Date()): Promise<void> {
    return this.serial(async () => {
      const e = this.entry(id);
      await this.fs.moveToTrash(e.fileName, `${now.getTime()}--${e.fileName}`);
      this.entries.delete(id);
    });
  }

  listTrash(): Promise<TrashEntry[]> {
    return this.serial(async () => {
      const result: TrashEntry[] = [];
      for (const trashName of await this.fs.listTrash()) {
        const info = parseTrashName(trashName);
        if (!info) continue;
        const { body } = parseNote(await this.fs.readTrash(trashName));
        result.push({ trashName, title: titleFromBody(body), preview: previewFromBody(body), trashedAt: info.trashedAt });
      }
      return result.sort((a, b) => b.trashedAt - a.trashedAt);
    });
  }

  readTrash(trashName: string): Promise<string> {
    return this.serial(async () => parseNote(await this.fs.readTrash(trashName)).body);
  }

  restore(trashName: string): Promise<NoteSummary> {
    return this.serial(async () => {
      const info = parseTrashName(trashName);
      if (!info) throw new Error(`Not a trash entry: ${trashName}`);
      const target = await this.uniqueName(info.fileName);
      await this.fs.restoreFromTrash(trashName, target);
      const { id, entry } = await this.load(target, await this.fs.read(target));
      if (entry.idPending) await this.write(id, entry);
      this.entries.set(id, entry);
      return this.summary(id, entry);
    });
  }

  deleteFromTrash(trashName: string): Promise<void> {
    return this.serial(() => this.fs.deleteFromTrash(trashName));
  }

  /** Permanently deletes trash entries older than `maxAgeMs`. Returns how many. */
  purgeTrash(maxAgeMs = TRASH_RETENTION_MS, now: Date = new Date()): Promise<number> {
    return this.serial(async () => {
      let count = 0;
      for (const trashName of await this.fs.listTrash()) {
        const info = parseTrashName(trashName);
        if (info && now.getTime() - info.trashedAt > maxAgeMs) {
          await this.fs.deleteFromTrash(trashName);
          count++;
        }
      }
      return count;
    });
  }

  // -------------------------------------------------------------------------
  // Renaming
  // -------------------------------------------------------------------------

  /** If a two-step rename was interrupted, make the file visible again. */
  private async recoverInterruptedRenames(): Promise<void> {
    for (const name of await this.fs.list()) {
      if (!/^\.rename-[a-z0-9]+\.tmp$/.test(name)) continue;
      const target = await this.uniqueName(`wiederhergestellt-${name.slice(8, -4)}.md`);
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
    const target = await this.uniqueName(desired);
    await this.fs.rename(current, target);
    return target;
  }

  private result(id: string, e: Entry): SaveResult {
    return { id, fileName: e.fileName, title: e.title, preview: e.preview, modified: e.modified };
  }
}

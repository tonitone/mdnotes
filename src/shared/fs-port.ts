/**
 * Minimal file system interface for a workspace folder.
 *
 * Notes are files directly inside the workspace. Three subfolders are
 * managed by the app: `.trash/` for deleted notes, `assets/` for images and
 * `.history/<id>/` for versions. All names
 * passed in are plain file names, never paths.
 */
export interface FsPort {
  /** File names (no subfolders) in the workspace. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  /** Last modification in milliseconds. */
  mtime(name: string): Promise<number>;
  exists(name: string): Promise<boolean>;
  /** Creates a new file and fails if it exists (error code EEXIST). */
  create(name: string, text: string): Promise<void>;
  /** Replaces the content atomically: write a temp file, then rename. */
  writeAtomic(name: string, text: string): Promise<void>;
  /** Renames. The target must not exist unless it is the same file. */
  rename(from: string, to: string): Promise<void>;

  /** File names in `.trash/`. */
  listTrash(): Promise<string[]>;
  readTrash(trashName: string): Promise<string>;
  /** Moves a note into `.trash/` under a new name. Fails if that name exists. */
  moveToTrash(name: string, trashName: string): Promise<void>;
  /** Moves a file out of `.trash/` back into the workspace. Fails if `name` exists. */
  restoreFromTrash(trashName: string, name: string): Promise<void>;
  deleteFromTrash(trashName: string): Promise<void>;

  /** Writes an image into `assets/`. Returns false if it already existed (same name = same content). */
  writeAsset(name: string, bytes: Uint8Array): Promise<boolean>;
  readAsset(name: string): Promise<Uint8Array>;

  /** Version file names of a note in `.history/<id>/`. Empty if there are none. */
  listHistory(id: string): Promise<string[]>;
  readHistory(id: string, name: string): Promise<string>;
  /** Creates a version file. Does nothing if it already exists (same name = same content). */
  writeHistory(id: string, name: string, text: string): Promise<void>;
  deleteHistory(id: string, name: string): Promise<void>;
  /** Removes all versions of a note. */
  deleteAllHistory(id: string): Promise<void>;
}

export class FileExistsError extends Error {
  readonly code = 'EEXIST';
  constructor(name: string) {
    super(`File already exists: ${name}`);
  }
}

interface MemoryFile {
  name: string;
  text: string;
  mtime: number;
}

/**
 * In-memory file system for browser mode and tests.
 * `caseInsensitive` mimics the behavior of macOS and Windows.
 */
export class MemoryFs implements FsPort {
  private files = new Map<string, MemoryFile>();
  private trash = new Map<string, MemoryFile>();
  private assets = new Map<string, Uint8Array>();
  private history = new Map<string, Map<string, string>>();
  private clock = 0;

  constructor(private readonly caseInsensitive = false) {}

  private key(name: string): string {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }

  private tick(): number {
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }

  private get(map: Map<string, MemoryFile>, name: string): MemoryFile {
    const f = map.get(this.key(name));
    if (!f) throw new Error(`File not found: ${name}`);
    return f;
  }

  async list(): Promise<string[]> {
    return [...this.files.values()].map((f) => f.name);
  }

  async read(name: string): Promise<string> {
    return this.get(this.files, name).text;
  }

  async mtime(name: string): Promise<number> {
    return this.get(this.files, name).mtime;
  }

  async exists(name: string): Promise<boolean> {
    return this.files.has(this.key(name));
  }

  async create(name: string, text: string): Promise<void> {
    if (this.files.has(this.key(name))) throw new FileExistsError(name);
    this.files.set(this.key(name), { name, text, mtime: this.tick() });
  }

  async writeAtomic(name: string, text: string): Promise<void> {
    const existing = this.files.get(this.key(name));
    this.files.set(this.key(name), { name: existing?.name ?? name, text, mtime: this.tick() });
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.get(this.files, from);
    const sameFile = this.key(from) === this.key(to);
    if (!sameFile && this.files.has(this.key(to))) throw new FileExistsError(to);
    this.files.delete(this.key(from));
    this.files.set(this.key(to), { ...f, name: to });
  }

  async listTrash(): Promise<string[]> {
    return [...this.trash.values()].map((f) => f.name);
  }

  async readTrash(trashName: string): Promise<string> {
    return this.get(this.trash, trashName).text;
  }

  async moveToTrash(name: string, trashName: string): Promise<void> {
    const f = this.get(this.files, name);
    if (this.trash.has(this.key(trashName))) throw new FileExistsError(trashName);
    this.files.delete(this.key(name));
    this.trash.set(this.key(trashName), { ...f, name: trashName });
  }

  async restoreFromTrash(trashName: string, name: string): Promise<void> {
    const f = this.get(this.trash, trashName);
    if (this.files.has(this.key(name))) throw new FileExistsError(name);
    this.trash.delete(this.key(trashName));
    this.files.set(this.key(name), { ...f, name, mtime: this.tick() });
  }

  async deleteFromTrash(trashName: string): Promise<void> {
    this.get(this.trash, trashName);
    this.trash.delete(this.key(trashName));
  }

  async writeAsset(name: string, bytes: Uint8Array): Promise<boolean> {
    if (this.assets.has(this.key(name))) return false;
    this.assets.set(this.key(name), bytes.slice());
    return true;
  }

  async readAsset(name: string): Promise<Uint8Array> {
    const bytes = this.assets.get(this.key(name));
    if (!bytes) throw new Error(`File not found: assets/${name}`);
    return bytes;
  }

  async listHistory(id: string): Promise<string[]> {
    return [...(this.history.get(id)?.keys() ?? [])];
  }

  async readHistory(id: string, name: string): Promise<string> {
    const text = this.history.get(id)?.get(name);
    if (text === undefined) throw new Error(`File not found: .history/${id}/${name}`);
    return text;
  }

  async writeHistory(id: string, name: string, text: string): Promise<void> {
    const versions = this.history.get(id) ?? new Map<string, string>();
    if (!versions.has(name)) versions.set(name, text);
    this.history.set(id, versions);
  }

  async deleteHistory(id: string, name: string): Promise<void> {
    this.history.get(id)?.delete(name);
  }

  async deleteAllHistory(id: string): Promise<void> {
    this.history.delete(id);
  }

  /** Tests and demo data only: store a file as if it came from outside the app. */
  putExternal(name: string, text: string, mtime = this.tick()): void {
    this.files.set(this.key(name), { name, text, mtime });
  }

  /** Tests only: remove a file as if it was deleted outside the app. */
  removeExternal(name: string): void {
    this.files.delete(this.key(name));
  }
}

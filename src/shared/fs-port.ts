/**
 * Minimal file system interface for a workspace folder.
 * All names are file names directly inside the workspace, not paths.
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
}

export class FileExistsError extends Error {
  readonly code = 'EEXIST';
  constructor(name: string) {
    super(`File already exists: ${name}`);
  }
}

/**
 * In-memory file system for browser mode and tests.
 * `caseInsensitive` mimics the behavior of macOS and Windows.
 */
export class MemoryFs implements FsPort {
  private files = new Map<string, { name: string; text: string; mtime: number }>();
  private clock = 0;

  constructor(private readonly caseInsensitive = false) {}

  private key(name: string): string {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }

  private tick(): number {
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }

  async list(): Promise<string[]> {
    return [...this.files.values()].map((f) => f.name);
  }

  async read(name: string): Promise<string> {
    const f = this.files.get(this.key(name));
    if (!f) throw new Error(`File not found: ${name}`);
    return f.text;
  }

  async mtime(name: string): Promise<number> {
    const f = this.files.get(this.key(name));
    if (!f) throw new Error(`File not found: ${name}`);
    return f.mtime;
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
    const f = this.files.get(this.key(from));
    if (!f) throw new Error(`File not found: ${from}`);
    const sameFile = this.key(from) === this.key(to);
    if (!sameFile && this.files.has(this.key(to))) throw new FileExistsError(to);
    this.files.delete(this.key(from));
    this.files.set(this.key(to), { ...f, name: to });
  }

  /** Tests and demo data only: store a file as if it came from outside the app. */
  putExternal(name: string, text: string): void {
    this.files.set(this.key(name), { name, text, mtime: this.tick() });
  }
}

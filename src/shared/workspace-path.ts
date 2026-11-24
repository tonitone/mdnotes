/**
 * Workspace-relative note paths: POSIX separators (`/`) on every platform,
 * no leading slash, no `.` or `..` segments. Shared by `NodeFs`, `MemoryFs`
 * and `NoteStore`, so both file systems agree on what a note path is.
 */

/** Deeper folders are ignored when the workspace is scanned. */
export const MAX_FOLDER_DEPTH = 10;

/**
 * Directories that are never scanned or watched: every hidden directory
 * (`.trash`, `.history`, `.git`, …), `assets` directly in the root and
 * `node_modules` at any level. `depth` is 0 for a directory in the root.
 */
export function isSkippedDir(name: string, depth: number): boolean {
  return name.startsWith('.') || name === 'node_modules' || (depth === 0 && name === 'assets');
}

/** True if `rel` is a well-formed relative path: no empty, `.` or `..` segment, no backslash or NUL. */
export function isValidRelativePath(rel: string): boolean {
  if (!rel || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** True if no directory of `rel` is skipped and the path is not nested too deep. */
export function isScannedPath(rel: string): boolean {
  const dirs = rel.split('/').slice(0, -1);
  return dirs.length <= MAX_FOLDER_DEPTH && dirs.every((dir, depth) => !isSkippedDir(dir, depth));
}

/** True for a Markdown note: `.md`, not hidden (temp files), not inside a skipped folder. */
export function isNotePath(rel: string): boolean {
  const name = baseName(rel);
  return name.toLowerCase().endsWith('.md') && !name.startsWith('.') && isScannedPath(rel);
}

/** The folder of a path (`''` for the root). */
export function folderOf(rel: string): string {
  const at = rel.lastIndexOf('/');
  return at === -1 ? '' : rel.slice(0, at);
}

/** The last segment of a path. */
export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

/** Joins a folder (may be `''`) and a file name. */
export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

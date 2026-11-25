/**
 * Helpers for files stored in the workspace's `assets/` folder: images (shown
 * in the note) and other attachments (linked, opened with the system's app).
 * Names are content-addressed: `<16 hex digits>.<extension>`.
 */

export const ASSET_DIR = 'assets';
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * Extensions that run code when opened with the system's default app. Such
 * files are never stored as attachments, so a click on a note link can never
 * start a program. Lower case, without the dot.
 */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'mst', 'msc', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'ocx',
  'ps1', 'ps1xml', 'ps2', 'psc1', 'psd1', 'psm1', 'vb', 'vbe', 'vbs', 'js', 'jse', 'mjs', 'cjs', 'ws', 'wsc',
  'wsf', 'wsh', 'hta', 'lnk', 'url', 'scf', 'reg', 'inf', 'ins', 'isp', 'gadget', 'application', 'appref-ms',
  'msix', 'msixbundle', 'appx', 'appxbundle', 'library-ms', 'settingcontent-ms', 'xll', 'chm',
  // macOS
  'app', 'command', 'tool', 'pkg', 'mpkg', 'dmg', 'scpt', 'scptd', 'applescript', 'workflow', 'action',
  'terminal', 'webloc', 'inetloc', 'fileloc', 'osax', 'prefpane', 'kext', 'dylib',
  // Linux and Unix
  'sh', 'bash', 'zsh', 'csh', 'tcsh', 'ksh', 'fish', 'run', 'bin', 'out', 'elf', 'so', 'appimage', 'desktop',
  'deb', 'rpm', 'snap', 'flatpak', 'flatpakref',
  // Cross-platform runtimes and packages
  'jar', 'jnlp', 'class', 'py', 'pyc', 'pyo', 'pyw', 'pyz', 'pl', 'pm', 'rb', 'php', 'lua', 'tcl', 'apk', 'xpi',
  'crx', 'vsix',
]);

/** Extension used for files that have none. */
const PLAIN_EXT = 'dat';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const ASSET_NAME_RE = /^[0-9a-f]{16}\.([a-z0-9]{1,16})$/;
const IMAGE_NAME_RE = /^[0-9a-f]{16}\.(png|jpg|jpeg|gif|webp|svg)$/;

export function isImageMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

/** Any stored asset: an image or an attachment with an allowed extension. */
export function isAssetName(name: string): boolean {
  const m = ASSET_NAME_RE.exec(name);
  return m !== null && !BLOCKED_EXTENSIONS.has(m[1]);
}

/** An asset the app shows inline as an image. */
export function isImageAssetName(name: string): boolean {
  return IMAGE_NAME_RE.test(name);
}

/**
 * The extension an attachment is stored under, from its original file name:
 * lower case, letters and digits only. `null` if it may run code.
 */
export function attachmentExtension(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const m = /.\.([^.]+)$/.exec(base.replace(/[.\s]+$/, ''));
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === '') return PLAIN_EXT;
  if (BLOCKED_EXTENSIONS.has(ext)) return null;
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : PLAIN_EXT;
}

export function isAllowedAttachment(fileName: string): boolean {
  return attachmentExtension(fileName) !== null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content-addressed name: identical images end up as one file. */
export async function assetNameFor(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);
  return `${(await sha256Hex(bytes)).slice(0, 16)}.${ext}`;
}

/** Content-addressed name for an attachment; identical files end up as one. */
export async function attachmentNameFor(bytes: Uint8Array, fileName: string): Promise<string> {
  const ext = attachmentExtension(fileName);
  if (!ext) throw new Error(`Blocked file type: ${fileName}`);
  return `${(await sha256Hex(bytes)).slice(0, 16)}.${ext}`;
}

/** `assets/abc.png` → `abc.png` if it points into the asset folder, else null. */
export function assetNameFromPath(src: string): string | null {
  const m = /^(?:\.\/)?assets\/([^/?#]+)$/.exec(src.trim());
  return m && isAssetName(m[1]) ? m[1] : null;
}

/** `assets/abc.pdf` → `abc.pdf` if it is a stored attachment (not an image), else null. */
export function attachmentNameFromPath(src: string): string | null {
  const name = assetNameFromPath(src);
  return name && !isImageAssetName(name) ? name : null;
}

/** Markdown link for an attachment. The file name is the link text. */
export function attachmentMarkdown(fileName: string, path: string): string {
  const text = fileName.replace(/[\r\n]+/g, ' ').replace(/([\\[\]])/g, '\\$1').trim() || path;
  return `[${text}](${path})`;
}

/** All asset file names referenced by a note body: images and linked attachments. */
export function referencedAssets(body: string): string[] {
  const names = new Set<string>();
  for (const m of body.matchAll(/\]\(\s*<?([^)\s>]+)>?/g)) {
    const name = assetNameFromPath(m[1]);
    if (name) names.add(name);
  }
  return [...names];
}

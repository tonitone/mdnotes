/** Helpers for images stored in the workspace's `assets/` folder. */

export const ASSET_DIR = 'assets';
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

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

const ASSET_NAME_RE = /^[0-9a-f]{16}\.(png|jpg|jpeg|gif|webp|svg)$/;

export function isImageMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

export function isAssetName(name: string): boolean {
  return ASSET_NAME_RE.test(name);
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

/** `assets/abc.png` → `abc.png` if it points into the asset folder, else null. */
export function assetNameFromPath(src: string): string | null {
  const m = /^(?:\.\/)?assets\/([^/?#]+)$/.exec(src.trim());
  return m && isAssetName(m[1]) ? m[1] : null;
}

/** All asset file names referenced by a note body. */
export function referencedAssets(body: string): string[] {
  const names = new Set<string>();
  for (const m of body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) {
    const name = assetNameFromPath(m[1]);
    if (name) names.add(name);
  }
  return [...names];
}

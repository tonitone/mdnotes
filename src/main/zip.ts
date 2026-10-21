import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader and writer for backups (no ZIP64, no encryption).
 * Entries are deflated; stored entries are accepted when reading.
 *
 * Reading is defensive: paths must be relative and stay inside the target,
 * sizes are limited (zip bombs) and every CRC is checked.
 */

export interface ZipEntry {
  /** Relative path with forward slashes, e.g. `assets/abc.png`. */
  path: string;
  data: Uint8Array;
  mtime?: Date;
}

export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

export class ZipError extends Error {}

/** Throws unless `p` is a safe relative path (protects against zip slip). */
export function assertSafePath(p: string): void {
  const parts = p.split('/');
  if (
    !p ||
    p.startsWith('/') ||
    p.includes('\\') ||
    p.includes('\0') ||
    /^[a-zA-Z]:/.test(p) ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new ZipError(`Unsafe path in archive: ${p}`);
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    assertSafePath(entry.path);
    if (seen.has(entry.path)) throw new ZipError(`Duplicate path: ${entry.path}`);
    seen.add(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const { time, date } = dosDateTime(entry.mtime ?? new Date());
    if (entry.data.byteLength > 0xfffffffe || offset > 0xfffffffe) throw new ZipError('Archive too large (no ZIP64 support).');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function findEnd(buf: Buffer): number {
  // The end record is at most 22 + 65535 (comment) bytes from the end.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === END_SIG) return i;
  }
  throw new ZipError('Not a ZIP file.');
}

export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('Not a ZIP file.');
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new ZipError('Too many entries.');

  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) throw new ZipError('Corrupt central directory.');
    const method = buf.readUInt16LE(pos + 10);
    const checksum = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const path = buf.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    pos += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith('/')) continue; // directory entry
    assertSafePath(path);
    if (size > MAX_ENTRY_BYTES) throw new ZipError(`Entry too large: ${path}`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new ZipError('Archive too large.');

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new ZipError(`Corrupt entry: ${path}`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (raw.length !== compressedSize) throw new ZipError(`Truncated entry: ${path}`);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: size + 1 });
    else throw new ZipError(`Unsupported compression in ${path}`);
    if (data.length !== size || crc32(data) !== checksum) throw new ZipError(`Checksum mismatch: ${path}`);
    entries.push({ path, data: new Uint8Array(data) });
  }
  return entries;
}

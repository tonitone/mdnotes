/**
 * Reads the pixel size from the header of PNG, JPEG, GIF and WebP files.
 * Needed for DOCX export, where every image has a fixed size. Returns null
 * for unknown or broken data.
 */

export interface ImageSize {
  width: number;
  height: number;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || be32(b, 0) !== 0x89504e47 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

function gif(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || !ascii(b, 0, 6).startsWith('GIF8')) return null;
  return { width: le16(b, 6), height: le16(b, 8) };
}

function jpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    const length = be16(b, i + 2);
    // Start of frame markers (baseline, progressive, ...), but not DHT, JPG, DAC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  return null;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  const size = png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

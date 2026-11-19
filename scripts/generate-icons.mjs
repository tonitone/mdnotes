// Regenerates the app icons from build/icon/mdnotes-icon.svg:
//   build/icon/mdnotes-icon.png  1024 px master
//   build/icons/<n>x<n>.png      Linux sizes (electron-builder picks them up)
//   build/icon.ico               Windows (PNG-compressed entries)
//   build/icon.icns              macOS (PNG-compressed entries, 16 to 1024 px)
// Usage: node scripts/generate-icons.mjs   (needs the Playwright Chromium from `npm ci`)
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const svg = await readFile(path.join(buildDir, 'icon', 'mdnotes-icon.svg'));
const dataUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`;

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const png = {};
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block">`,
  );
  await page.waitForFunction(() => document.images[0].complete);
  png[size] = await page.screenshot({ omitBackground: true, type: 'png' });
}
await browser.close();

await mkdir(path.join(buildDir, 'icons'), { recursive: true });
await writeFile(path.join(buildDir, 'icon', 'mdnotes-icon.png'), png[1024]);
for (const size of SIZES) {
  if (size !== 24 && size <= 512) await writeFile(path.join(buildDir, 'icons', `${size}x${size}.png`), png[size]);
}

// Windows .ico: header, directory, then PNG payloads (supported since Vista).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(icoSizes.length, 4);
const dir = Buffer.alloc(16 * icoSizes.length);
let offset = header.length + dir.length;
icoSizes.forEach((size, i) => {
  const e = i * 16;
  dir.writeUInt8(size === 256 ? 0 : size, e);
  dir.writeUInt8(size === 256 ? 0 : size, e + 1);
  dir.writeUInt16LE(1, e + 4); // planes
  dir.writeUInt16LE(32, e + 6); // bit depth
  dir.writeUInt32LE(png[size].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += png[size].length;
});
await writeFile(path.join(buildDir, 'icon.ico'), Buffer.concat([header, dir, ...icoSizes.map((s) => png[s])]));

// macOS .icns: big-endian chunks of PNG data. Retina variants reuse the next larger render.
const icnsTypes = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];
const chunks = icnsTypes.map(([type, size]) => {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'ascii');
  h.writeUInt32BE(8 + png[size].length, 4);
  return Buffer.concat([h, png[size]]);
});
const body = Buffer.concat(chunks);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(8 + body.length, 4);
await writeFile(path.join(buildDir, 'icon.icns'), Buffer.concat([icnsHeader, body]));
console.log('Icons written to build/.');

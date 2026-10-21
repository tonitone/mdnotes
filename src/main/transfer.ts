import { BrowserWindow, app, dialog } from 'electron';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExportFormat, ImportReport } from '../shared/api';
import { ASSET_DIR, MAX_ASSET_BYTES, MIME_BY_EXT, assetNameFor, assetNameFromPath, referencedAssets } from '../shared/assets';
import { markdownToPrintDocument } from '../shared/markdown/html';
import { markdownToWiki } from '../shared/markdown/wiki';
import { t, type MessageKey } from '../shared/i18n';
import { slugify } from '../shared/note';
import type { Workspace } from './workspace';

/** Export and import of notes. Runs in the main process. */

const FORMATS: Record<ExportFormat, { ext: string; filter: MessageKey; title: MessageKey }> = {
  markdown: { ext: 'md', filter: 'filter.markdown', title: 'dialog.exportMarkdown' },
  wiki: { ext: 'txt', filter: 'filter.wiki', title: 'dialog.exportWiki' },
  pdf: { ext: 'pdf', filter: 'filter.pdf', title: 'dialog.exportPdf' },
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function timestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Copies the images a note references into `<targetDir>/assets/`. */
async function copyAssets(ws: Workspace, body: string, targetDir: string): Promise<void> {
  const names = referencedAssets(body);
  if (names.length === 0) return;
  const dir = path.join(targetDir, ASSET_DIR);
  await mkdir(dir, { recursive: true });
  for (const name of names) {
    try {
      await copyFile(path.join(ws.root, ASSET_DIR, name), path.join(dir, name), constants.COPYFILE_EXCL);
    } catch (err) {
      // EEXIST: same name means same content. ENOENT: image is gone, keep exporting.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOENT') throw err;
    }
  }
}

async function renderPdf(html: string): Promise<Buffer> {
  const file = path.join(app.getPath('temp'), `mdnotes-print-${randomBytes(6).toString('hex')}.html`);
  await writeFile(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    win.destroy();
    await rm(file, { force: true });
  }
}

export async function exportNote(ws: Workspace, parent: BrowserWindow, id: string, format: ExportFormat): Promise<string | null> {
  const doc = ws.store.read(id);
  const spec = FORMATS[format];
  const result = await dialog.showSaveDialog(parent, {
    title: t(spec.title),
    defaultPath: path.join(app.getPath('documents'), `${slugify(doc.title)}.${spec.ext}`),
    filters: [{ name: t(spec.filter), extensions: [spec.ext] }],
  });
  if (result.canceled || !result.filePath) return null;
  const target = result.filePath;

  if (format === 'markdown') {
    await writeFile(target, doc.body, 'utf8');
    await copyAssets(ws, doc.body, path.dirname(target));
  } else if (format === 'wiki') {
    await writeFile(target, markdownToWiki(doc.body), 'utf8');
  } else {
    const html = markdownToPrintDocument(doc.body, doc.title, {
      resolveImage: (src) => {
        const name = assetNameFromPath(src);
        return name ? pathToFileURL(path.join(ws.root, ASSET_DIR, name)).href : src;
      },
    });
    await writeFile(target, await renderPdf(html));
  }
  return target;
}

/** Writes every note (with front matter) and its images into a new folder. */
export async function exportAll(ws: Workspace, parent: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(parent, {
    title: t('dialog.chooseExportFolder'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = path.join(result.filePaths[0], `mdnotes-export-${timestamp()}`);
  await mkdir(folder); // not recursive: fails instead of writing into an existing folder
  for (const note of ws.store.summaries()) {
    const text = ws.store.fileText(note.id);
    await writeFile(path.join(folder, note.fileName), text, { encoding: 'utf8', flag: 'wx' });
    await copyAssets(ws, text, folder);
  }
  return folder;
}

/** Copies local images referenced by an imported file into `assets/` and rewrites the links. */
async function importImages(ws: Workspace, text: string, sourceDir: string, source: string, warnings: string[]): Promise<string> {
  const pattern = /(!\[[^\]]*\]\()\s*<?([^)\s>]+)>?((?:\s+"[^"]*")?\))/g;
  const replacements = new Map<string, string>();
  for (const m of text.matchAll(pattern)) {
    const src = m[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('#') || replacements.has(src)) continue;
    const ext = path.extname(src).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    const file = path.resolve(sourceDir, decodeURI(src));
    try {
      if (!mime) throw new Error('unsupported');
      if ((await stat(file)).size > MAX_ASSET_BYTES) throw new Error('too large');
      const bytes = new Uint8Array(await readFile(file));
      const name = await assetNameFor(bytes, mime);
      await ws.fs.writeAsset(name, bytes);
      replacements.set(src, `${ASSET_DIR}/${name}`);
    } catch {
      warnings.push(t('main.imageNotImported', { source, src }));
    }
  }
  return text.replace(pattern, (whole, open: string, src: string, close: string) => {
    const target = replacements.get(src);
    return target ? `${open}${target}${close}` : whole;
  });
}

export async function importFromDialog(ws: Workspace, parent: BrowserWindow): Promise<ImportReport | null> {
  const result = await dialog.showOpenDialog(parent, {
    title: t('dialog.importMarkdown'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('filter.markdown'), extensions: ['md', 'markdown', 'txt'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const report: ImportReport = { imported: 0, skipped: 0, warnings: [] };
  for (const file of result.filePaths) {
    const name = path.basename(file);
    try {
      if ((await stat(file)).size > MAX_IMPORT_BYTES) throw new Error('too large');
      const text = await importImages(ws, await readFile(file, 'utf8'), path.dirname(file), name, report.warnings);
      if (await ws.store.importNote(text, name)) report.imported++;
      else report.skipped++;
    } catch {
      report.warnings.push(t('main.fileUnreadable', { name }));
    }
  }
  return report;
}

export async function importTexts(ws: Workspace, files: Array<{ name: string; text: string }>): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, skipped: 0, warnings: [] };
  for (const { name, text } of files) {
    if (await ws.store.importNote(text, name)) report.imported++;
    else report.skipped++;
    if (/!\[[^\]]*\]\((?![a-z][a-z0-9+.-]*:)(?!assets\/[0-9a-f]{16}\.)/i.test(text)) {
      report.warnings.push(t('main.dropNoImages', { name }));
    }
  }
  return report;
}

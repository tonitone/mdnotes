import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Smoke test of the real Electron app (main process, preload, IPC, asset
 * protocol, file watcher). Runs against the build in out/.
 */

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CRASH_ID = '01JAB3K9ZZ4QWERTYVPASD1234';

let root: string;
let workspace: string;
let backups: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdnotes-e2e-'));
  workspace = path.join(root, 'workspace');
  const userData = path.join(root, 'profile');
  await mkdir(path.join(workspace, 'assets'), { recursive: true });
  await mkdir(userData, { recursive: true });

  const asset = `${createHash('sha256').update(PIXEL_PNG).digest('hex').slice(0, 16)}.png`;
  await writeFile(path.join(workspace, 'assets', asset), PIXEL_PNG);
  // Image, code block, task and diagram, so the editor's widgets render under the app's CSP.
  await writeFile(path.join(workspace, 'hallo.md'), `# Hallo\n\n![Pixel](assets/${asset})\n\n- [ ] Aufgabe\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`);
  // A note in a subfolder: the workspace is scanned recursively.
  await mkdir(path.join(workspace, 'projekte'));
  await writeFile(path.join(workspace, 'projekte', 'unterordner.md'), '# Im Unterordner\n');
  // A note with unsaved text left over from a "crash".
  await writeFile(path.join(workspace, 'crash.md'), `---\nid: ${CRASH_ID}\nlabels: []\ncreated: 2026-10-01T10:00:00.000Z\n---\n# Crash\n`);
  await mkdir(path.join(userData, 'recovery'));
  await writeFile(path.join(userData, 'recovery', `${CRASH_ID}.md`), '# Crash gerettet\n\nNicht gespeichert');
  backups = path.join(root, 'backups');
  await writeFile(
    path.join(userData, 'config.json'),
    // German UI regardless of the runner's OS language.
    JSON.stringify({ workspace, language: 'de', backup: { folder: backups, auto: 'off', includeHistory: true, keep: 10 } }),
  );

  app = await electron.launch({
    // --no-sandbox only for CI runners without unprivileged user namespaces.
    args: ['.', '--no-sandbox'],
    env: { ...process.env, MDNOTES_USER_DATA: userData },
  });
  page = await app.firstWindow();
  page.on('pageerror', (err) => console.error('pageerror:', err.message));
});

test.afterAll(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
});

const listItems = () => page.locator('#notesList ui5-li');

test('starts with the configured workspace', async () => {
  // A cold start on CI runners can take longer than the default timeout.
  // The visible path is shortened; the full path is the tooltip.
  await expect(page.locator('#workspacePath')).toHaveAttribute('title', workspace, { timeout: 20_000 });
  await expect(listItems().filter({ hasText: 'Hallo' })).toHaveCount(1);
});

test('lists a note from a subfolder with its folder', async () => {
  const item = listItems().filter({ hasText: 'Im Unterordner' });
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('tooltip', 'projekte/unterordner.md');
});

test('offers unsaved text left over from a crash', async () => {
  const notice = page.locator('#noticeRegion');
  await expect(notice).toContainText('Crash gerettet');
  await notice.locator('ui5-button', { hasText: 'Wiederherstellen' }).click();
  await expect(page.locator('.cm-content')).toContainText('Nicht gespeichert');
  await expect
    .poll(async () => {
      const file = (await readdir(workspace)).find((f) => f.startsWith('crash-gerettet--') || f === 'crash.md');
      return file ? readFile(path.join(workspace, file), 'utf8') : '';
    }, { timeout: 10_000 })
    .toContain('Nicht gespeichert');
});

test('shows images through the asset protocol', async () => {
  await listItems().filter({ hasText: 'Hallo' }).click();
  const img = page.locator('img.cm-md-image');
  await expect(img).toHaveAttribute('src', /^mdnotes-asset:\/\/local\/[0-9a-f]{16}\.png$/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
});

test('renders a Mermaid diagram through the hidden frame', async () => {
  await listItems().filter({ hasText: 'Hallo' }).click();
  // Mermaid runs in mermaid.html, loaded from file:// next to the app (frame-src 'self').
  const diagram = page.locator('.cm-md-diagram img');
  await expect(diagram).toHaveAttribute('src', /^data:image\/svg\+xml/, { timeout: 15_000 });
  await expect.poll(() => diagram.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('exports a note with its image as HTML and Word document', async () => {
  await listItems().filter({ hasText: 'Hallo' }).click();
  for (const format of ['html', 'docx'] as const) {
    const target = path.join(root, `export.${format}`);
    // Replace the save dialog, which tests cannot operate.
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, target);
    await page.locator('#exportButton').click();
    await page.locator(`#exportMenu ui5-menu-item[data-format="${format}"]`).click();
    await expect.poll(async () => (await readFile(target).catch(() => Buffer.alloc(0))).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const data = await readFile(target);
    if (format === 'html') {
      expect(data.toString('utf8')).toContain('<img src="data:image/png;base64,');
    } else {
      expect(data.subarray(0, 2).toString()).toBe('PK');
      expect(data.includes(Buffer.from('word/media/image1.png'))).toBe(true);
    }
  }
});

test('keeps an existing Markdown target when the destination assets folder is a link', async () => {
  test.skip(process.platform === 'win32', 'symbolic links need extra rights on Windows');
  await listItems().filter({ hasText: 'Hallo' }).click();
  const folder = path.join(root, 'md-export');
  const outside = path.join(root, 'md-export-outside');
  await mkdir(folder);
  await mkdir(outside);
  const target = path.join(folder, 'hallo.md');
  await writeFile(target, 'original');
  // The note references an image, so the export needs `assets/` next to the target.
  await symlink(outside, path.join(folder, 'assets'), 'dir');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, target);
  await page.locator('#exportButton').click();
  await page.locator('#exportMenu ui5-menu-item[data-format="markdown"]').click();
  await expect(page.locator('#errorRegion')).toContainText('Der Export ist fehlgeschlagen.', { timeout: 10_000 });
  expect(await readFile(target, 'utf8')).toBe('original');
  expect(await readdir(outside)).toEqual([]);
  await page.locator('#errorRegion ui5-message-strip').evaluate((strip) => strip.remove());
});

test('creates a note on disk, saves it and renames it after its title', async () => {
  await page.locator('#newNoteButton').click();
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.type('# Aus Electron\n\nText');
  try {
    await expect
      .poll(async () => (await readdir(workspace)).find((f) => f.startsWith('aus-electron--')), { timeout: 15_000 })
      .toBeTruthy();
  } catch {
    // Diagnostics for CI, where only the error message is visible.
    const doc = await page.locator('.cm-content').innerText();
    const status = await page.locator('#saveStatus').innerText();
    const error = await page.locator('#errorRegion').innerText();
    throw new Error(`File not renamed. files=${JSON.stringify(await readdir(workspace))} doc=${JSON.stringify(doc)} status=${status} error=${error}`);
  }
  const file = (await readdir(workspace)).find((f) => f.startsWith('aus-electron--'))!;
  expect(await readFile(path.join(workspace, file), 'utf8')).toContain('# Aus Electron\n\nText');
});

test('shows the versions of a note', async () => {
  await page.locator('#versionsButton').click();
  const dialog = page.locator('ui5-dialog');
  await expect(dialog.locator('ui5-li').first()).toBeVisible();
  await dialog.locator('ui5-button', { hasText: 'Schließen' }).click();
  await expect(page.locator('ui5-dialog')).toHaveCount(0);
});

test('writes a verified backup to the backup folder', async () => {
  await page.locator('#backupItem').click();
  const dialog = page.locator('ui5-dialog');
  await dialog.locator('ui5-button', { hasText: 'Jetzt sichern' }).click();
  await expect.poll(async () => (await readdir(backups)).filter((f) => f.endsWith('.zip')).length).toBe(1);
  await expect(dialog.locator('ui5-list ui5-li')).toHaveCount(1);
  await dialog.locator('ui5-button', { hasText: 'Schließen' }).click();
});

test('stores attachments in assets/ and refuses programs', async () => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { notesApi: import('../../src/shared/api').NotesApi }).notesApi;
    const saved = await api.saveAttachment(new TextEncoder().encode('%PDF-1.7'), 'Bericht.PDF');
    const refused = await api.saveAttachment(new TextEncoder().encode('MZ'), 'setup.exe').then(
      () => 'stored',
      () => 'refused',
    );
    // A path outside assets/ is never opened; nothing is launched in this test.
    const outside = await api.openAttachment('../hallo.md').then(
      () => 'opened',
      () => 'refused',
    );
    return { saved, refused, outside, url: api.assetUrl(saved) };
  });
  expect(result.saved).toMatch(/^assets\/[0-9a-f]{16}\.pdf$/);
  expect(result).toMatchObject({ refused: 'refused', outside: 'refused', url: null });
  expect(await readFile(path.join(workspace, result.saved), 'utf8')).toBe('%PDF-1.7');
  expect((await readdir(path.join(workspace, 'assets'))).some((f) => f.endsWith('.exe'))).toBe(false);
});

test('never opens an attachment that is a link to a file elsewhere', async () => {
  test.skip(process.platform === 'win32', 'symbolic links need extra rights on Windows');
  const outside = path.join(root, 'outside.pdf');
  await writeFile(outside, '%PDF-1.7');
  await symlink(outside, path.join(workspace, 'assets', 'abcdefabcdefabcd.pdf'));
  // Nothing is launched: the check in the main process refuses the link first.
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { notesApi: import('../../src/shared/api').NotesApi }).notesApi;
    const tryIt = (p: Promise<void>) => p.then(() => 'done', () => 'refused');
    return {
      open: await tryIt(api.openAttachment('assets/abcdefabcdefabcd.pdf')),
      reveal: await tryIt(api.revealAttachment('assets/abcdefabcdefabcd.pdf')),
      missing: await tryIt(api.openAttachment('assets/0000000000000000.pdf')),
    };
  });
  expect(result).toEqual({ open: 'refused', reveal: 'refused', missing: 'refused' });
});

test('picks up files added outside the app', async () => {
  await writeFile(path.join(workspace, 'extern.md'), '# Von draußen\n');
  await expect(listItems().filter({ hasText: 'Von draußen' })).toHaveCount(1, { timeout: 10_000 });
});

test('moves notes to the trash folder', async () => {
  await listItems().filter({ hasText: 'Von draußen' }).click();
  await page.locator('#deleteButton').click();
  await expect.poll(async () => (await readdir(path.join(workspace, '.trash'))).length).toBe(1);
  expect((await readdir(workspace)).includes('extern.md')).toBe(false);
});

test('shows the subfolder in the folder tree and filters by it', async () => {
  // On a small screen (the Windows runner) the window is narrower than 1024 px, where the column layout
  // shows only the list and the editor. Show the library next to the list; choosing "All notes" at the end
  // lets the app set its own layout again.
  await page.locator('#fcl').evaluate((fcl) => ((fcl as HTMLElement & { layout: string }).layout = 'ThreeColumnsMidExpanded'));
  const folder = page.locator('#folderTree ui5-tree-item[data-folder="projekte"]');
  await expect(folder).toBeVisible();
  await expect(folder).toHaveJSProperty('text', 'projekte');
  await expect(folder).toHaveJSProperty('additionalText', '1');
  // The root carries the workspace folder's name.
  await expect(page.locator('#folderTree ui5-tree-item[data-folder=""]')).toHaveJSProperty('text', path.basename(workspace));
  await folder.click({ position: { x: 150, y: 12 } });
  await expect(listItems()).toHaveCount(1);
  await expect(listItems().first()).toContainText('Im Unterordner');
  await page.locator('#allNotesItem').click();
  await expect(listItems().filter({ hasText: 'Hallo' })).toHaveCount(1);
});

test('reports no Content Security Policy violations', async () => {
  // Open the appearance menu as well, so its styles are applied once.
  await page.locator('#themeItem').click();
  await expect(page.locator('#themeMenu')).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations).toEqual([]);
});

// Last, because it reloads the window.
test('pins a note in its front matter and keeps the sort order in config.json, also after a reload', async () => {
  await listItems().filter({ hasText: 'Hallo' }).click();
  await expect(page.locator('.cm-content')).toContainText('Aufgabe');
  await page.locator('#editorMoreButton').click();
  await page.locator('#pinMenuItem').click();
  const hallo = async () => {
    const name = (await readdir(workspace)).find((f) => f.startsWith('hallo'));
    return name ? readFile(path.join(workspace, name), 'utf8') : '';
  };
  await expect.poll(hallo, { timeout: 10_000 }).toMatch(/\npinned: true\n---\n# Hallo\n\n!\[Pixel\]/);

  await page.locator('#sortButton').click();
  await page.locator('#sortMenu ui5-menu-item[data-sort="title"]').click();
  const config = path.join(root, 'profile', 'config.json');
  await expect.poll(async () => JSON.parse(await readFile(config, 'utf8')).noteSort, { timeout: 10_000 }).toBe('title');

  await page.reload();
  await expect(listItems().filter({ hasText: 'Hallo' })).toHaveAttribute('icon', 'pushpin-on', { timeout: 20_000 });
  await expect(page.locator('#sortMenu ui5-menu-item[data-sort="title"]')).toHaveJSProperty('checked', true);
  await expect(page.locator('#notesList ui5-li-group')).toHaveCount(0);
});

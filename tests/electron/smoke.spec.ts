import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  await writeFile(path.join(workspace, 'hallo.md'), `# Hallo\n\n![Pixel](assets/${asset})\n`);
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
  await expect(page.locator('#workspacePath')).toHaveText(workspace);
  await expect(listItems().filter({ hasText: 'Hallo' })).toHaveCount(1);
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

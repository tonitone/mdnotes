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

let root: string;
let workspace: string;
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
  await writeFile(path.join(userData, 'config.json'), JSON.stringify({ workspace }));

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

test('shows images through the asset protocol', async () => {
  await listItems().filter({ hasText: 'Hallo' }).click();
  const img = page.locator('img.cm-md-image');
  await expect(img).toHaveAttribute('src', /^mdnotes-asset:\/\/local\/[0-9a-f]{16}\.png$/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
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

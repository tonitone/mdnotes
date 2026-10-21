import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportFormat, MenuCommand, NotesChangedEvent } from '../shared/api';
import { ASSET_DIR, MAX_ASSET_BYTES, MIME_BY_EXT, assetNameFor, isAssetName, isImageMime } from '../shared/assets';
import { isNoteId } from '../shared/note';
import { exportAll, exportNote, importFromDialog, importTexts } from './transfer';
import { Workspace } from './workspace';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL; // set by electron-vite in dev mode
const MAX_NOTE_BYTES = 10 * 1024 * 1024;
const ASSET_SCHEME = 'mdnotes-asset';

let mainWindow: BrowserWindow | null = null;
let workspace: Workspace | null = null;

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------------------
// Config (only the workspace path), stored in the app's user data folder.
// ---------------------------------------------------------------------------

const configPath = () => path.join(app.getPath('userData'), 'config.json');

async function loadConfig(): Promise<{ workspace?: string }> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function saveConfig(config: { workspace?: string }): Promise<void> {
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

function notifyChanged(event: NotesChangedEvent): void {
  mainWindow?.webContents.send('notes:changed', event);
}

async function openWorkspace(dir: string): Promise<void> {
  const next = new Workspace(dir, notifyChanged);
  await next.open();
  workspace?.close();
  workspace = next;
}

// ---------------------------------------------------------------------------
// Security: no network, no navigation, no new windows.
// ---------------------------------------------------------------------------

function isAllowedUrl(url: string): boolean {
  if (/^(file|devtools|data|blob|mdnotes-asset):/.test(url)) return true;
  if (devServerUrl) {
    const dev = new URL(devServerUrl);
    try {
      const u = new URL(url);
      return u.hostname === dev.hostname && u.port === dev.port; // http and ws for hot reload
    } catch {
      return false;
    }
  }
  return false;
}

function hardenSession(): void {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedUrl(details.url) });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
}

/** Serves images from the workspace's assets folder as mdnotes-asset://local/<name>. */
function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    if (!workspace || !isAssetName(name)) return new Response(null, { status: 404 });
    try {
      const bytes = await workspace.fs.readAsset(name);
      return new Response(bytes.slice().buffer as ArrayBuffer, {
        headers: {
          'content-type': MIME_BY_EXT[name.split('.').pop()!] ?? 'application/octet-stream',
          // SVGs must never run scripts.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

/** Only accept IPC from our own window. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!mainWindow || event.sender !== mainWindow.webContents || !isAllowedUrl(url)) {
    throw new Error('Rejected IPC from unknown sender.');
  }
}

// ---------------------------------------------------------------------------
// Argument validation. Everything coming from the renderer is untrusted.
// ---------------------------------------------------------------------------

function requireWorkspace(): Workspace {
  if (!workspace) throw new Error('No workspace selected.');
  return workspace;
}

function requireWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('No window.');
  return mainWindow;
}

function requireId(id: unknown): string {
  if (!isNoteId(id)) throw new Error('Invalid note ID.');
  return id;
}

function requireText(text: unknown, max = MAX_NOTE_BYTES): string {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > max) throw new Error('Invalid text.');
  return text;
}

function requireLabels(labels: unknown): string[] {
  if (!Array.isArray(labels) || labels.length > 50 || !labels.every((l) => typeof l === 'string' && l.length <= 100)) {
    throw new Error('Invalid labels.');
  }
  return labels;
}

function requireTrashName(name: unknown): string {
  if (typeof name !== 'string' || !/^\d{10,}--[^/\\]+\.md$/i.test(name)) throw new Error('Invalid trash entry.');
  return name;
}

function requireFormat(format: unknown): ExportFormat {
  if (format !== 'markdown' && format !== 'wiki' && format !== 'pdf') throw new Error('Invalid export format.');
  return format;
}

function requireFiles(files: unknown): Array<{ name: string; text: string }> {
  if (!Array.isArray(files) || files.length > 200) throw new Error('Invalid files.');
  return files.map((f) => {
    const { name, text } = (f ?? {}) as { name?: unknown; text?: unknown };
    return { name: requireText(name, 255), text: requireText(text) };
  });
}

// ---------------------------------------------------------------------------
// IPC handlers. Each channel maps to exactly one NotesApi method.
// ---------------------------------------------------------------------------

function registerIpc(): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event);
      return fn(...args);
    });

  handle('workspace:get', () => workspace?.root ?? null);

  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Workspace-Ordner wählen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    await openWorkspace(result.filePaths[0]);
    await saveConfig({ workspace: workspace?.root });
    return workspace?.root ?? null;
  });

  handle('notes:list', () => requireWorkspace().store.summaries());
  handle('notes:read', (id) => requireWorkspace().store.read(requireId(id)));
  handle('notes:create', () => requireWorkspace().store.create());
  handle('notes:save', (id, body) => requireWorkspace().store.save(requireId(id), requireText(body)));
  handle('notes:finalize', (id) => requireWorkspace().store.finalize(requireId(id)));
  handle('notes:setLabels', (id, labels) => requireWorkspace().store.setLabels(requireId(id), requireLabels(labels)));
  handle('notes:search', (query) => requireWorkspace().store.search(requireText(query, 500)));

  handle('trash:move', (id) => requireWorkspace().store.trash(requireId(id)));
  handle('trash:list', () => requireWorkspace().store.listTrash());
  handle('trash:read', (name) => requireWorkspace().store.readTrash(requireTrashName(name)));
  handle('trash:restore', (name) => requireWorkspace().store.restore(requireTrashName(name)));
  handle('trash:delete', (name) => requireWorkspace().store.deleteFromTrash(requireTrashName(name)));

  handle('assets:save', async (bytes, mime) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
      throw new Error('Invalid image data.');
    }
    if (typeof mime !== 'string' || !isImageMime(mime)) throw new Error('Unsupported image type.');
    const name = await assetNameFor(bytes, mime);
    await requireWorkspace().fs.writeAsset(name, bytes);
    return `${ASSET_DIR}/${name}`;
  });

  handle('transfer:exportNote', (id, format) => exportNote(requireWorkspace(), requireWindow(), requireId(id), requireFormat(format)));
  handle('transfer:exportAll', () => exportAll(requireWorkspace(), requireWindow()));
  handle('transfer:import', () => importFromDialog(requireWorkspace(), requireWindow()));
  handle('transfer:importTexts', (files) => importTexts(requireWorkspace(), requireFiles(files)));
}

// ---------------------------------------------------------------------------
// Native menu. Shortcuts use CmdOrCtrl, i.e. Cmd on macOS.
// ---------------------------------------------------------------------------

function sendMenu(command: MenuCommand): void {
  mainWindow?.webContents.send('menu:command', command);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Ablage',
      submenu: [
        { label: 'Neue Notiz', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-note') },
        { label: 'Workspace wählen …', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('choose-workspace') },
        { type: 'separator' },
        { label: 'Importieren …', click: () => sendMenu('import') },
        { label: 'Alle Notizen exportieren …', click: () => sendMenu('export-all') },
        { type: 'separator' },
        // No shortcut on purpose: Cmd+Backspace deletes text in the editor.
        { label: 'Notiz in den Papierkorb', click: () => sendMenu('delete-note') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Beenden' },
      ],
    },
    { role: 'editMenu', label: 'Bearbeiten' },
    {
      label: 'Darstellung',
      submenu: [
        { label: 'Suchen', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu', label: 'Fenster' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Window. Before closing, the renderer saves pending changes.
// ---------------------------------------------------------------------------

function createWindow(): void {
  let allowClose = false;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: 'mdnotes',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Links in notes open in the default browser, never inside the app.
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Never navigate away from the app, e.g. when a file is dropped on the window.
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on('close', (event) => {
    if (allowClose || !mainWindow) return;
    event.preventDefault();
    mainWindow.webContents.send('app:flush-request');
    // Close anyway if the renderer does not respond.
    setTimeout(() => {
      allowClose = true;
      mainWindow?.close();
    }, 3000);
  });
  ipcMain.removeAllListeners('app:flushed');
  ipcMain.on('app:flushed', (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    allowClose = true;
    mainWindow?.close();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(here, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  hardenSession();
  registerAssetProtocol();
  registerIpc();
  buildMenu();

  const config = await loadConfig();
  if (config.workspace && existsSync(config.workspace)) {
    try {
      await openWorkspace(config.workspace);
    } catch (err) {
      console.error('Could not open last workspace:', err);
    }
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  workspace?.close();
  if (process.platform !== 'darwin') app.quit();
});

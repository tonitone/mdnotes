import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MenuCommand } from '../shared/api';
import { isNoteId } from '../shared/note';
import { NoteStore } from '../shared/note-store';
import { NodeFs } from './node-fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL; // set by electron-vite in dev mode
const MAX_NOTE_BYTES = 10 * 1024 * 1024;

let mainWindow: BrowserWindow | null = null;
let store: NoteStore | null = null;
let workspace: string | null = null;

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

async function openWorkspace(dir: string): Promise<void> {
  workspace = dir;
  store = new NoteStore(new NodeFs(dir));
  await store.scan();
}

// ---------------------------------------------------------------------------
// Security: no network, no navigation, no new windows.
// ---------------------------------------------------------------------------

function isAllowedUrl(url: string): boolean {
  if (url.startsWith('file://') || url.startsWith('devtools://') || url.startsWith('data:') || url.startsWith('blob:')) {
    return true;
  }
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

/** Only accept IPC from our own window. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!mainWindow || event.sender !== mainWindow.webContents || !isAllowedUrl(url)) {
    throw new Error('Rejected IPC from unknown sender.');
  }
}

function requireStore(): NoteStore {
  if (!store) throw new Error('No workspace selected.');
  return store;
}

function requireId(id: unknown): string {
  if (!isNoteId(id)) throw new Error('Invalid note ID.');
  return id;
}

function requireBody(body: unknown): string {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_NOTE_BYTES) {
    throw new Error('Invalid note content.');
  }
  return body;
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

  handle('workspace:get', () => workspace);

  handle('workspace:choose', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Workspace-Ordner wählen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    await openWorkspace(result.filePaths[0]);
    await saveConfig({ workspace: workspace ?? undefined });
    return workspace;
  });

  handle('notes:list', () => requireStore().summaries());
  handle('notes:read', (id) => requireStore().read(requireId(id)));
  handle('notes:create', () => requireStore().create());
  handle('notes:save', (id, body) => requireStore().save(requireId(id), requireBody(body)));
  handle('notes:finalize', (id) => requireStore().finalize(requireId(id)));
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
    if (!isAllowedUrl(url)) event.preventDefault();
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
  registerIpc();
  buildMenu();

  const config = await loadConfig();
  if (config.workspace && existsSync(config.workspace)) {
    await openWorkspace(config.workspace);
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

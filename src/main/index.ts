import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackupKind, BackupSettings, ExportFormat, MenuCommand, NotesChangedEvent } from '../shared/api';
import { ASSET_DIR, MAX_ASSET_BYTES, MIME_BY_EXT, assetNameFor, isAssetName, isImageMime } from '../shared/assets';
import { VERSION_NAME_RE } from '../shared/history';
import { isLanguageChoice, resolveLocale, setLocale, t, type LanguageChoice } from '../shared/i18n';
import { isNoteId } from '../shared/note';
import {
  assertBackupFolder,
  backupNotes,
  createBackup,
  isBackupName,
  isDailyBackupDue,
  listBackups,
  restoreNotes,
  restoreToFolder,
  verifyBackup,
} from './backup';
import { RecoveryStore } from './recovery';
import { exportAll, exportNote, importFromDialog, importTexts } from './transfer';
import { Workspace } from './workspace';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL; // set by electron-vite in dev mode
const MAX_NOTE_BYTES = 10 * 1024 * 1024;
const ASSET_SCHEME = 'mdnotes-asset';

let mainWindow: BrowserWindow | null = null;
let workspace: Workspace | null = null;
/** Set when the user quits; the window then closes after saving and the app exits. */
let quitting = false;

// Tests start the app with a separate profile (see tests/electron).
if (process.env.MDNOTES_USER_DATA) app.setPath('userData', process.env.MDNOTES_USER_DATA);

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------------------
// Config (workspace path and backup settings), stored in the app's user data folder.
// ---------------------------------------------------------------------------

interface AppConfig {
  workspace?: string;
  backup: BackupSettings;
  language: LanguageChoice;
}

const DEFAULT_BACKUP: BackupSettings = { folder: null, auto: 'off', includeHistory: false, keep: 10 };
let config: AppConfig = { backup: { ...DEFAULT_BACKUP }, language: 'system' };
let recovery: RecoveryStore | null = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');

async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<AppConfig>;
    return {
      workspace: raw.workspace,
      backup: { ...DEFAULT_BACKUP, ...(raw.backup ?? {}) },
      language: isLanguageChoice(raw.language) ? raw.language : 'system',
    };
  } catch {
    return { backup: { ...DEFAULT_BACKUP }, language: 'system' };
  }
}

/** The locale for the configured language; `system` follows the OS language list. */
function currentLanguage() {
  const preferred = app.getPreferredSystemLanguages?.() ?? [];
  const locale = resolveLocale(config.language, [...preferred, app.getLocale()]);
  return { choice: config.language, locale };
}

function applyLanguage(): void {
  setLocale(currentLanguage().locale);
  buildMenu();
}

async function saveConfig(): Promise<void> {
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
  config.workspace = dir;
  await saveConfig();
  void runDailyBackupIfDue();
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

function backupFolder(): string {
  if (!config.backup.folder) throw new Error(t('main.noBackupFolder'));
  return config.backup.folder;
}

function runBackup(kind: BackupKind) {
  const ws = requireWorkspace();
  return createBackup(ws.root, backupFolder(), { kind, includeHistory: config.backup.includeHistory, keep: config.backup.keep });
}

/** Backup before risky actions (import, permanent delete). Never blocks the action. */
async function safetyBackup(): Promise<void> {
  if (!config.backup.folder || !workspace) return;
  try {
    await runBackup('safety');
  } catch (err) {
    console.error('Safety backup failed:', err);
  }
}

async function runDailyBackupIfDue(): Promise<void> {
  if (config.backup.auto !== 'daily' || !config.backup.folder || !workspace) return;
  try {
    if (isDailyBackupDue(await listBackups(config.backup.folder))) await runBackup('auto');
  } catch (err) {
    console.error('Daily backup failed:', err);
  }
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

const EXPORT_FORMATS: readonly ExportFormat[] = ['markdown', 'wiki', 'pdf', 'html', 'docx'];

function requireFormat(format: unknown): ExportFormat {
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) throw new Error('Invalid export format.');
  return format as ExportFormat;
}

function requireFiles(files: unknown): Array<{ name: string; text: string }> {
  if (!Array.isArray(files) || files.length > 200) throw new Error('Invalid files.');
  return files.map((f) => {
    const { name, text } = (f ?? {}) as { name?: unknown; text?: unknown };
    return { name: requireText(name, 255), text: requireText(text) };
  });
}

function requireVersionName(name: unknown): string {
  if (typeof name !== 'string' || !VERSION_NAME_RE.test(name)) throw new Error('Invalid version.');
  return name;
}

function requireBackupName(name: unknown): string {
  if (typeof name !== 'string' || !isBackupName(name)) throw new Error('Invalid backup.');
  return name;
}

function requireNotePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length > 10_000 || !paths.every((p) => typeof p === 'string' && /^[^/\\]+\.md$/i.test(p))) {
    throw new Error('Invalid note paths.');
  }
  return paths;
}

function requireBackupPatch(patch: unknown): Partial<Omit<BackupSettings, 'folder'>> {
  const p = (patch ?? {}) as Record<string, unknown>;
  const result: Partial<Omit<BackupSettings, 'folder'>> = {};
  if (p.auto !== undefined) {
    if (p.auto !== 'off' && p.auto !== 'quit' && p.auto !== 'daily') throw new Error('Invalid setting.');
    result.auto = p.auto;
  }
  if (p.includeHistory !== undefined) result.includeHistory = p.includeHistory === true;
  if (p.keep !== undefined) {
    if (!Number.isInteger(p.keep) || (p.keep as number) < 1 || (p.keep as number) > 1000) throw new Error('Invalid setting.');
    result.keep = p.keep as number;
  }
  return result;
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
      title: t('dialog.chooseWorkspace'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    await openWorkspace(result.filePaths[0]);
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
  handle('trash:delete', async (name) => {
    const trashName = requireTrashName(name);
    await safetyBackup();
    return requireWorkspace().store.deleteFromTrash(trashName);
  });

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
  handle('transfer:import', async () => {
    await safetyBackup();
    return importFromDialog(requireWorkspace(), requireWindow());
  });
  handle('transfer:importTexts', async (files) => {
    const valid = requireFiles(files);
    await safetyBackup();
    return importTexts(requireWorkspace(), valid);
  });

  handle('versions:list', (id) => requireWorkspace().store.listVersions(requireId(id)));
  handle('versions:read', (id, name) => requireWorkspace().store.readVersion(requireId(id), requireVersionName(name)));
  handle('versions:restore', (id, name) => requireWorkspace().store.restoreVersion(requireId(id), requireVersionName(name)));
  handle('labels:rename', (from, to) => requireWorkspace().store.renameLabel(requireText(from, 200), requireText(to, 200)));

  handle('backup:getSettings', () => config.backup);
  handle('backup:updateSettings', async (patch) => {
    config.backup = { ...config.backup, ...requireBackupPatch(patch) };
    await saveConfig();
    void runDailyBackupIfDue();
    return config.backup;
  });
  handle('backup:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: t('dialog.chooseBackupFolder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0];
    if (workspace) assertBackupFolder(workspace.root, folder);
    config.backup = { ...config.backup, folder };
    await saveConfig();
    return config.backup;
  });
  handle('backup:create', () => runBackup('manual'));
  handle('backup:list', () => (config.backup.folder ? listBackups(config.backup.folder) : []));
  handle('backup:verify', (file) => verifyBackup(backupFolder(), requireBackupName(file)));
  handle('backup:notes', (file) => backupNotes(backupFolder(), requireBackupName(file)));
  handle('backup:restoreNotes', async (file, paths) => {
    const name = requireBackupName(file);
    const valid = requireNotePaths(paths);
    await safetyBackup();
    const ws = requireWorkspace();
    return restoreNotes(ws.store, ws.fs, backupFolder(), name, valid);
  });
  handle('backup:restoreToFolder', async (file) => {
    const name = requireBackupName(file);
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: t('dialog.chooseRestoreFolder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const target = result.filePaths[0];
    await restoreToFolder(backupFolder(), name, target);
    await openWorkspace(target);
    return target;
  });

  handle('recovery:write', (id, body) => recovery?.write(requireId(id), requireText(body)));
  handle('recovery:clear', (id) => recovery?.clear(requireId(id)));
  handle('language:get', () => currentLanguage());
  handle('language:set', async (choice) => {
    if (!isLanguageChoice(choice)) throw new Error('Invalid language.');
    config.language = choice;
    await saveConfig();
    applyLanguage();
    return currentLanguage();
  });

  handle('recovery:list', () => (recovery && workspace ? recovery.list(workspace.store) : []));
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
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newNote'), accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-note') },
        { label: t('menu.chooseWorkspace'), accelerator: 'CmdOrCtrl+O', click: () => sendMenu('choose-workspace') },
        { type: 'separator' },
        { label: t('menu.import'), click: () => sendMenu('import') },
        { label: t('menu.exportAll'), click: () => sendMenu('export-all') },
        { type: 'separator' },
        // No shortcut on purpose: Cmd+Backspace deletes text in the editor.
        { label: t('menu.trashNote'), click: () => sendMenu('delete-note') },
        { label: t('menu.versions'), accelerator: 'CmdOrCtrl+Alt+V', click: () => sendMenu('versions') },
        { type: 'separator' },
        { label: t('menu.backup'), click: () => sendMenu('backup') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: t('menu.quit') },
      ],
    },
    { role: 'editMenu', label: t('menu.edit') },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.find'), accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu', label: t('menu.window') },
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
    // Closing was delayed to save pending changes, which cancels a running
    // quit. Resume it, otherwise Cmd+Q would only close the window on macOS.
    if (quitting) app.quit();
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

  config = await loadConfig();
  applyLanguage();
  recovery = new RecoveryStore(path.join(app.getPath('userData'), 'recovery'));
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

app.on('before-quit', () => {
  quitting = true;
});

// Backup on quit runs after the window saved and closed.
let quitBackupDone = false;
app.on('will-quit', (event) => {
  if (quitBackupDone || config.backup.auto !== 'quit' || !config.backup.folder || !workspace) return;
  event.preventDefault();
  quitBackupDone = true;
  runBackup('auto')
    .catch((err) => console.error('Backup on quit failed:', err))
    .finally(() => app.quit());
});

// Long-running sessions still get their daily backup.
setInterval(() => void runDailyBackupIfDue(), 60 * 60 * 1000).unref();

app.on('window-all-closed', () => {
  workspace?.close();
  if (process.platform !== 'darwin') app.quit();
});

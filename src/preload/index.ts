import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, NotesApi, NotesChangedEvent } from '../shared/api';

/**
 * Bridge between renderer and main process. The renderer only gets these
 * functions, no access to Node or ipcRenderer itself.
 */

/** Same rule as `assetNameFromPath` in shared/assets.ts (kept inline: preload must stay tiny). */
function assetUrl(src: string): string | null {
  const m = /^(?:\.\/)?assets\/([0-9a-f]{16}\.(?:png|jpg|jpeg|gif|webp|svg))$/.exec(src.trim());
  return m ? `mdnotes-asset://local/${m[1]}` : null;
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: NotesApi = {
  mode: 'electron',
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (id) => ipcRenderer.invoke('notes:read', id),
  createNote: () => ipcRenderer.invoke('notes:create'),
  saveNote: (id, body) => ipcRenderer.invoke('notes:save', id, body),
  finalizeNote: (id) => ipcRenderer.invoke('notes:finalize', id),
  setLabels: (id, labels) => ipcRenderer.invoke('notes:setLabels', id, labels),
  searchNotes: (query) => ipcRenderer.invoke('notes:search', query),

  trashNote: (id) => ipcRenderer.invoke('trash:move', id),
  listTrash: () => ipcRenderer.invoke('trash:list'),
  readTrash: (name) => ipcRenderer.invoke('trash:read', name),
  restoreFromTrash: (name) => ipcRenderer.invoke('trash:restore', name),
  deleteFromTrash: (name) => ipcRenderer.invoke('trash:delete', name),

  saveAsset: (bytes, mime) => ipcRenderer.invoke('assets:save', bytes, mime),
  assetUrl,

  exportNote: (id, format) => ipcRenderer.invoke('transfer:exportNote', id, format),
  exportAll: () => ipcRenderer.invoke('transfer:exportAll'),
  importNotes: () => ipcRenderer.invoke('transfer:import'),
  importTexts: (files) => ipcRenderer.invoke('transfer:importTexts', files),

  listVersions: (id) => ipcRenderer.invoke('versions:list', id),
  readVersion: (id, name) => ipcRenderer.invoke('versions:read', id, name),
  restoreVersion: (id, name) => ipcRenderer.invoke('versions:restore', id, name),
  renameLabel: (from, to) => ipcRenderer.invoke('labels:rename', from, to),

  getBackupSettings: () => ipcRenderer.invoke('backup:getSettings'),
  updateBackupSettings: (patch) => ipcRenderer.invoke('backup:updateSettings', patch),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  verifyBackup: (file) => ipcRenderer.invoke('backup:verify', file),
  listBackupNotes: (file) => ipcRenderer.invoke('backup:notes', file),
  restoreBackupNotes: (file, paths) => ipcRenderer.invoke('backup:restoreNotes', file, paths),
  restoreBackupToFolder: (file) => ipcRenderer.invoke('backup:restoreToFolder', file),

  writeRecovery: (id, body) => ipcRenderer.invoke('recovery:write', id, body),
  clearRecovery: (id) => ipcRenderer.invoke('recovery:clear', id),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),

  onMenuCommand: (callback) => subscribe<MenuCommand>('menu:command', callback),
  onNotesChanged: (callback) => subscribe<NotesChangedEvent>('notes:changed', callback),

  onFlushRequest(callback) {
    const listener = async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send('app:flushed');
      }
    };
    ipcRenderer.on('app:flush-request', listener);
    return () => ipcRenderer.removeListener('app:flush-request', listener);
  },
};

contextBridge.exposeInMainWorld('notesApi', api);

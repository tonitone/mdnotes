import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, NotesApi } from '../shared/api';

/**
 * Bridge between renderer and main process. The renderer only gets these
 * functions, no access to Node or ipcRenderer itself.
 */
const api: NotesApi = {
  mode: 'electron',
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (id) => ipcRenderer.invoke('notes:read', id),
  createNote: () => ipcRenderer.invoke('notes:create'),
  saveNote: (id, body) => ipcRenderer.invoke('notes:save', id, body),
  finalizeNote: (id) => ipcRenderer.invoke('notes:finalize', id),

  onMenuCommand(callback) {
    const listener = (_event: unknown, command: MenuCommand) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },

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

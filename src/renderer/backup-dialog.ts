import type { BackupInfo, BackupSettings, ImportReport, NotesApi } from '../shared/api';
import { announce, confirmDialog, el, infoDialog, type Ui5Element } from './ui';
import { formatVersionTime } from './versions';

/**
 * Backup dialog: where backups go, when they are made automatically, and
 * the list of existing backups with check and restore actions.
 */

export interface BackupDialogHooks {
  /** Notes were restored into the open workspace. */
  onRestored: (report: ImportReport) => Promise<void>;
  /** A backup was restored into a new folder that is now the workspace. */
  onWorkspaceChanged: (folder: string) => Promise<void>;
}

const KIND_LABELS: Record<BackupInfo['kind'], string> = {
  manual: 'Manuell',
  auto: 'Automatisch',
  safety: 'Sicherheitskopie vor Import oder Löschen',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Lets the user pick notes from a backup. Resolves with the chosen paths or null. */
function pickNotes(notes: Array<{ path: string; title: string }>): Promise<string[] | null> {
  return new Promise((resolve) => {
    let result: string[] | null = null;
    const boxes = notes.map((n) => el('ui5-checkbox', { text: n.title, 'data-path': n.path }));
    const restore = el('ui5-button', { design: 'Emphasized' }, ['Wiederherstellen']);
    const cancel = el('ui5-button', { design: 'Transparent' }, ['Abbrechen']);
    const dialog = el('ui5-dialog', { headerText: 'Notizen wiederherstellen', accessibleName: 'Notizen wiederherstellen' }, [
      el('div', { className: 'dialog-content' }, [
        el('p', { className: 'dialog-hint' }, [
          'Gewählte Notizen kommen zusätzlich in den Workspace. Vorhandene Notizen werden nicht überschrieben; unveränderte werden übersprungen.',
        ]),
        el('div', { className: 'backup-note-list', 'attr:role': 'group', 'attr:aria-label': 'Notizen im Backup' }, boxes),
      ]),
      el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, [restore, cancel]),
    ]);
    restore.addEventListener('click', () => {
      result = boxes.filter((b) => b.checked).map((b) => b.dataset.path!);
      dialog.open = false;
    });
    cancel.addEventListener('click', () => (dialog.open = false));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result && result.length > 0 ? result : null);
    });
    document.body.append(dialog);
    dialog.open = true;
  });
}

export async function openBackupDialog(api: NotesApi, hooks: BackupDialogHooks): Promise<void> {
  let settings: BackupSettings = await api.getBackupSettings();

  const folderText = el('p', { className: 'backup-folder' });
  const chooseFolder = el('ui5-button', { icon: 'open-folder' }, ['Ordner wählen …']);
  const autoSelect = el('ui5-select', { id: 'backupAuto', accessibleName: 'Automatisch sichern' }, [
    el('ui5-option', { value: 'off' }, ['Aus']),
    el('ui5-option', { value: 'quit' }, ['Beim Beenden']),
    el('ui5-option', { value: 'daily' }, ['Täglich']),
  ]);
  const history = el('ui5-checkbox', { text: 'Versionshistorie mitsichern' });
  const backupNow = el('ui5-button', { design: 'Emphasized', icon: 'save' }, ['Jetzt sichern']);
  const list = el('ui5-list', { headerText: 'Vorhandene Backups', accessibleName: 'Vorhandene Backups', noDataText: 'Noch keine Backups' });
  const actions = el('ui5-menu', {}, [
    el('ui5-menu-item', { 'attr:text': 'Prüfen', icon: 'accept', 'data-action': 'verify' }),
    el('ui5-menu-item', { 'attr:text': 'Einzelne Notizen wiederherstellen …', icon: 'documents', 'data-action': 'notes' }),
    el('ui5-menu-item', { 'attr:text': 'Alles in neuen Ordner wiederherstellen …', icon: 'open-folder', 'data-action': 'all' }),
  ]);
  const close = el('ui5-button', { design: 'Transparent' }, ['Schließen']);
  let selectedFile: string | null = null;

  const render = async () => {
    folderText.textContent = settings.folder ?? 'Noch kein Ordner gewählt. Wähle einen Ordner außerhalb des Workspace, am besten auf einem anderen Laufwerk.';
    for (const option of autoSelect.children as HTMLCollectionOf<Ui5Element>) option.selected = option.value === settings.auto;
    history.checked = settings.includeHistory;
    backupNow.disabled = !settings.folder;
    autoSelect.disabled = !settings.folder;
    const backups = await api.listBackups();
    list.replaceChildren(
      ...backups.map((b) =>
        el('ui5-li', {
          icon: b.kind === 'safety' ? 'shield' : 'save',
          description: `${KIND_LABELS[b.kind]} · ${formatSize(b.size)}`,
          'data-file': b.file,
        }, [formatVersionTime(b.created)]),
      ),
    );
  };

  const dialog = el('ui5-dialog', { headerText: 'Backup', accessibleName: 'Backup' }, [
    el('div', { className: 'dialog-content backup-dialog' }, [
      el('ui5-title', { level: 'H3', size: 'H6' }, ['Speicherort']),
      folderText,
      chooseFolder,
      el('ui5-label', { 'attr:for': 'backupAuto', showColon: true }, ['Automatisch sichern']),
      autoSelect,
      history,
      el('p', { className: 'dialog-hint' }, [
        `Es werden die letzten ${settings.keep} Backups behalten. Vor einem Import und vor dem endgültigen Löschen legt die App zusätzlich eine Sicherheitskopie an.`,
      ]),
      backupNow,
      list,
      actions,
    ]),
    el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, [close]),
  ]);

  const guard = async (message: string, task: () => Promise<void>) => {
    try {
      await task();
    } catch (err) {
      console.error(err);
      await infoDialog('Fehler', [message, String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')]);
    }
  };

  chooseFolder.addEventListener('click', () =>
    guard('Der Ordner konnte nicht gesetzt werden.', async () => {
      const next = await api.chooseBackupFolder();
      if (next) settings = next;
      await render();
    }),
  );
  autoSelect.addEventListener('change', (event: Event) => {
    const value = (event as CustomEvent<{ selectedOption: Ui5Element }>).detail.selectedOption.value as BackupSettings['auto'];
    void guard('Die Einstellung konnte nicht gespeichert werden.', async () => {
      settings = await api.updateBackupSettings({ auto: value });
    });
  });
  history.addEventListener('change', () =>
    guard('Die Einstellung konnte nicht gespeichert werden.', async () => {
      settings = await api.updateBackupSettings({ includeHistory: Boolean(history.checked) });
    }),
  );
  backupNow.addEventListener('click', () =>
    guard('Das Backup ist fehlgeschlagen.', async () => {
      backupNow.disabled = true;
      try {
        const info = await api.createBackup();
        announce(`Backup gespeichert: ${info.file}`);
        await render();
      } finally {
        backupNow.disabled = !settings.folder;
      }
    }),
  );

  list.addEventListener('item-click', (event: Event) => {
    const item = (event as CustomEvent<{ item: Ui5Element }>).detail.item;
    selectedFile = item.dataset.file ?? null;
    actions.opener = item;
    actions.open = true;
  });
  actions.addEventListener('item-click', (event: Event) => {
    const action = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.action;
    const file = selectedFile;
    if (!file) return;
    if (action === 'verify') {
      void guard('Das Backup konnte nicht geprüft werden.', async () => {
        const check = await api.verifyBackup(file);
        if (check.ok) announce(`Backup in Ordnung: ${check.files} Dateien geprüft.`);
        else await infoDialog('Backup beschädigt', check.problems);
      });
    }
    if (action === 'notes') {
      void guard('Die Notizen konnten nicht wiederhergestellt werden.', async () => {
        const paths = await pickNotes(await api.listBackupNotes(file));
        if (paths) await hooks.onRestored(await api.restoreBackupNotes(file, paths));
      });
    }
    if (action === 'all') {
      void guard('Das Backup konnte nicht wiederhergestellt werden.', async () => {
        if (api.mode === 'browser') {
          announce('Das Wiederherstellen in einen Ordner gibt es nur in der App.');
          return;
        }
        const ok = await confirmDialog(
          'Backup in neuen Ordner wiederherstellen?',
          'Das Backup wird in einen leeren Ordner entpackt und dann als Workspace geöffnet. Dein bisheriger Workspace bleibt unverändert.',
          'Ordner wählen …',
          'Emphasized',
        );
        if (!ok) return;
        const folder = await api.restoreBackupToFolder(file);
        if (folder) {
          dialog.open = false;
          await hooks.onWorkspaceChanged(folder);
          announce(`Backup wiederhergestellt nach ${folder}`);
        }
      });
    }
  });

  close.addEventListener('click', () => (dialog.open = false));
  await new Promise<void>((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve();
    });
    document.body.append(dialog);
    void render().then(() => (dialog.open = true));
  });
}

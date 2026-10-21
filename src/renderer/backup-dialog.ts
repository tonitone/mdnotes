import type { BackupInfo, BackupSettings, ImportReport, NotesApi } from '../shared/api';
import { announce, confirmDialog, el, infoDialog, type Ui5Element } from './ui';
import { formatSize, formatVersionTime } from './format';
import { t } from '../shared/i18n';

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

const kindLabel = (kind: BackupInfo['kind']) => t(`backup.kind.${kind}`);

/** Lets the user pick notes from a backup. Resolves with the chosen paths or null. */
function pickNotes(notes: Array<{ path: string; title: string }>): Promise<string[] | null> {
  return new Promise((resolve) => {
    let result: string[] | null = null;
    const boxes = notes.map((n) => el('ui5-checkbox', { text: n.title, 'data-path': n.path }));
    const restore = el('ui5-button', { design: 'Emphasized' }, [t('trash.restore')]);
    const cancel = el('ui5-button', { design: 'Transparent' }, [t('dialog.cancel')]);
    const dialog = el('ui5-dialog', { headerText: t('backup.pickTitle'), accessibleName: t('backup.pickTitle') }, [
      el('div', { className: 'dialog-content' }, [
        el('p', { className: 'dialog-hint' }, [
          t('backup.pickHint'),
        ]),
        el('div', { className: 'backup-note-list', 'attr:role': 'group', 'attr:aria-label': t('backup.pickGroup') }, boxes),
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
  const chooseFolder = el('ui5-button', { icon: 'open-folder' }, [t('backup.chooseFolder')]);
  const autoSelect = el('ui5-select', { id: 'backupAuto', accessibleName: t('backup.auto') }, [
    el('ui5-option', { value: 'off' }, [t('backup.auto.off')]),
    el('ui5-option', { value: 'quit' }, [t('backup.auto.quit')]),
    el('ui5-option', { value: 'daily' }, [t('backup.auto.daily')]),
  ]);
  const history = el('ui5-checkbox', { text: t('backup.includeHistory') });
  const backupNow = el('ui5-button', { design: 'Emphasized', icon: 'save' }, [t('backup.now')]);
  const list = el('ui5-list', { headerText: t('backup.list'), accessibleName: t('backup.list'), noDataText: t('backup.none') });
  const actions = el('ui5-menu', {}, [
    el('ui5-menu-item', { 'attr:text': t('backup.verify'), icon: 'accept', 'data-action': 'verify' }),
    el('ui5-menu-item', { 'attr:text': t('backup.restoreNotes'), icon: 'documents', 'data-action': 'notes' }),
    el('ui5-menu-item', { 'attr:text': t('backup.restoreAll'), icon: 'open-folder', 'data-action': 'all' }),
  ]);
  const close = el('ui5-button', { design: 'Transparent' }, [t('dialog.close')]);
  let selectedFile: string | null = null;

  const render = async () => {
    folderText.textContent = settings.folder ?? t('backup.noFolder');
    for (const option of autoSelect.children as HTMLCollectionOf<Ui5Element>) option.selected = option.value === settings.auto;
    history.checked = settings.includeHistory;
    backupNow.disabled = !settings.folder;
    autoSelect.disabled = !settings.folder;
    const backups = await api.listBackups();
    list.replaceChildren(
      ...backups.map((b) =>
        el('ui5-li', {
          icon: b.kind === 'safety' ? 'shield' : 'save',
          description: `${kindLabel(b.kind)} · ${formatSize(b.size)}`,
          'data-file': b.file,
        }, [formatVersionTime(b.created)]),
      ),
    );
  };

  const dialog = el('ui5-dialog', { headerText: t('backup.title'), accessibleName: t('backup.title') }, [
    el('div', { className: 'dialog-content backup-dialog' }, [
      el('ui5-title', { level: 'H3', size: 'H6' }, [t('backup.location')]),
      folderText,
      chooseFolder,
      el('ui5-label', { 'attr:for': 'backupAuto', showColon: true }, [t('backup.auto')]),
      autoSelect,
      history,
      el('p', { className: 'dialog-hint' }, [
        t('backup.keepHint', { keep: settings.keep }),
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
      await infoDialog(t('dialog.error'), [message, String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')]);
    }
  };

  chooseFolder.addEventListener('click', () =>
    guard(t('backup.error.folder'), async () => {
      const next = await api.chooseBackupFolder();
      if (next) settings = next;
      await render();
    }),
  );
  autoSelect.addEventListener('change', (event: Event) => {
    const value = (event as CustomEvent<{ selectedOption: Ui5Element }>).detail.selectedOption.value as BackupSettings['auto'];
    void guard(t('backup.error.setting'), async () => {
      settings = await api.updateBackupSettings({ auto: value });
    });
  });
  history.addEventListener('change', () =>
    guard(t('backup.error.setting'), async () => {
      settings = await api.updateBackupSettings({ includeHistory: Boolean(history.checked) });
    }),
  );
  backupNow.addEventListener('click', () =>
    guard(t('backup.error.create'), async () => {
      backupNow.disabled = true;
      try {
        const info = await api.createBackup();
        announce(t('backup.saved', { file: info.file }));
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
      void guard(t('backup.error.verify'), async () => {
        const check = await api.verifyBackup(file);
        if (check.ok) announce(t('backup.ok', { count: check.files }));
        else await infoDialog(t('backup.damaged'), check.problems);
      });
    }
    if (action === 'notes') {
      void guard(t('backup.error.restoreNotes'), async () => {
        const paths = await pickNotes(await api.listBackupNotes(file));
        if (paths) await hooks.onRestored(await api.restoreBackupNotes(file, paths));
      });
    }
    if (action === 'all') {
      void guard(t('backup.error.restoreAll'), async () => {
        if (api.mode === 'browser') {
          announce(t('backup.appOnly'));
          return;
        }
        const ok = await confirmDialog(
          t('backup.restoreAllTitle'),
          t('backup.restoreAllText'),
          t('backup.chooseFolder'),
          'Emphasized',
        );
        if (!ok) return;
        const folder = await api.restoreBackupToFolder(file);
        if (folder) {
          dialog.open = false;
          await hooks.onWorkspaceChanged(folder);
          announce(t('backup.restoredTo', { folder }));
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

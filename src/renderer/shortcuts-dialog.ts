import { t } from '../shared/i18n';
import { el, type Ui5Element } from './ui';
import { keysLabel, SHORTCUT_GROUPS } from './shortcuts';

/** Whether the dialog is open, so a second Cmd+/ does not stack another one. */
let open = false;

export function isShortcutsDialogOpen(): boolean {
  return open;
}

/** Lists all keyboard shortcuts, grouped. Resolves when the dialog is closed. */
export function openShortcutsDialog(): Promise<void> {
  open = true;
  const mac = /mac|iphone|ipad/i.test(navigator.platform);
  const names = { ctrl: t('format.keyCtrl'), shift: t('format.keyShift'), alt: t('shortcuts.keyAlt') };

  const lists = SHORTCUT_GROUPS.map((group) =>
    el('ui5-list', { headerText: t(group.title), accessibleName: t(group.title), className: 'shortcut-list' }, group.entries.map((entry) =>
      el('ui5-li', { additionalText: keysLabel(entry.keys, { mac, names }), type: 'Inactive' }, [t(entry.label)]),
    )),
  );
  const close = el('ui5-button', { design: 'Emphasized' }, [t('dialog.close')]);
  const dialog = el<Ui5Element>('ui5-dialog', { headerText: t('shortcuts.title'), accessibleName: t('shortcuts.title') }, [
    el('div', { className: 'dialog-content shortcuts-dialog' }, lists),
    el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, [close]),
  ]);
  close.addEventListener('click', () => (dialog.open = false));

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      open = false;
      resolve();
    });
    document.body.append(dialog);
    dialog.open = true;
  });
}

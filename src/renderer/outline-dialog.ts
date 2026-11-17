import { t } from '../shared/i18n';
import type { OutlineEntry } from '../shared/markdown/outline';
import { el, type Ui5Element } from './ui';

/** Whether the dialog is open, so a second shortcut press does not stack another one. */
let open = false;

export function isOutlineDialogOpen(): boolean {
  return open;
}

/**
 * Lists the headings of the open note. Resolves with the chosen entry, or null
 * when the dialog was closed without a choice.
 */
export function openOutlineDialog(entries: OutlineEntry[]): Promise<OutlineEntry | null> {
  open = true;
  let chosen: OutlineEntry | null = null;
  // The indentation sits on our own span inside the item, never on the UI5 host.
  const items = entries.map((entry, index) =>
    el('ui5-li', { type: 'Active', additionalText: t('outline.level', { level: entry.level }), 'data-index': String(index) }, [
      el('span', { className: `outline-entry outline-level-${entry.level}` }, [entry.text]),
    ]),
  );
  const list = el<Ui5Element>('ui5-list', { accessibleName: t('outline.title'), noDataText: t('outline.empty'), className: 'outline-list' }, items);
  const close = el('ui5-button', { design: 'Emphasized' }, [t('dialog.close')]);
  const dialog = el<Ui5Element>('ui5-dialog', { headerText: t('outline.title'), accessibleName: t('outline.title') }, [
    el('div', { className: 'dialog-content outline-dialog' }, [list]),
    el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, [close]),
  ]);
  close.addEventListener('click', () => (dialog.open = false));
  list.addEventListener('item-click', (event: Event) => {
    const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
    chosen = entries[Number(item.dataset.index)] ?? null;
    dialog.open = false;
  });

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      open = false;
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.open = true;
  });
}

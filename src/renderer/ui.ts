/**
 * Small UI helpers on top of UI5 Web Components: dialogs that return a
 * promise, and short announcements for screen readers.
 */

import { t } from '../shared/i18n';

/** UI5 elements are only accessed through the properties used here. */
export type Ui5Element = HTMLElement & Record<string, any>;

export function el<T extends Ui5Element = Ui5Element>(tag: string, props: Record<string, unknown> = {}, children: Array<Node | string> = []): T {
  const node = document.createElement(tag) as T;
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('attr:')) node.setAttribute(key.slice(5), String(value));
    else if (key.startsWith('data-')) node.setAttribute(key, String(value));
    else (node as Record<string, unknown>)[key] = value;
  }
  node.append(...children);
  return node;
}

/** Shows a short message as toast and announces it to screen readers. */
export function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (region) {
    // Clear first so the same message is announced again.
    region.textContent = '';
    window.setTimeout(() => (region.textContent = message), 50);
  }
  const toast = document.getElementById('toast') as Ui5Element | null;
  if (toast) {
    toast.textContent = message;
    toast.open = true;
  }
}

interface DialogButton<T> {
  text: string;
  value: T;
  design?: 'Emphasized' | 'Negative' | 'Transparent' | 'Default';
}

/**
 * Opens a dialog and resolves with the value of the pressed button, or with
 * `cancelValue` when closed with Esc. The dialog removes itself afterwards.
 */
function openDialog<T>(headerText: string, content: Node[], buttons: Array<DialogButton<T>>, cancelValue: T, initialFocus?: string): Promise<T> {
  return new Promise((resolve) => {
    let result = cancelValue;
    const footer = el('div', { className: 'dialog-footer', 'attr:slot': 'footer' });
    for (const button of buttons) {
      const b = el('ui5-button', { design: button.design ?? 'Default' }, [button.text]);
      b.addEventListener('click', () => {
        result = button.value;
        dialog.open = false;
      });
      footer.append(b);
    }
    const dialog = el('ui5-dialog', { headerText, accessibleName: headerText, ...(initialFocus ? { initialFocus } : {}) }, [
      el('div', { className: 'dialog-content' }, content),
      footer,
    ]);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.open = true;
  });
}

export function confirmDialog(
  headerText: string,
  text: string,
  confirmText: string,
  design: 'Negative' | 'Emphasized' = 'Negative',
): Promise<boolean> {
  return openDialog(
    headerText,
    [el('p', {}, [text])],
    [
      { text: confirmText, value: true, design },
      { text: t('dialog.cancel'), value: false, design: 'Transparent' },
    ],
    false,
  );
}

/** Asks for a single line of text. Resolves with `null` when cancelled. */
export async function promptDialog(headerText: string, label: string, hint: string, value = '', cancelText = t('dialog.skip')): Promise<string | null> {
  const id = `prompt-${Date.now()}`;
  const input = el('ui5-input', { id, value, accessibleName: label, placeholder: label });
  const result = openDialog<'ok' | 'cancel'>(
    headerText,
    [el('ui5-label', { 'attr:for': id, showColon: true }, [label]), input, el('p', { className: 'dialog-hint' }, [hint])],
    [
      { text: t('dialog.apply'), value: 'ok', design: 'Emphasized' },
      { text: cancelText, value: 'cancel', design: 'Transparent' },
    ],
    'cancel',
    id,
  );
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      (input.closest('ui5-dialog')?.querySelector('ui5-button') as HTMLElement | null)?.click();
    }
  });
  return (await result) === 'ok' ? String(input.value ?? '') : null;
}

export function infoDialog(headerText: string, lines: string[]): Promise<void> {
  const list = el('ul', { className: 'dialog-list' }, lines.map((line) => el('li', {}, [line])));
  return openDialog(headerText, [list], [{ text: t('dialog.ok'), value: undefined, design: 'Emphasized' }], undefined);
}

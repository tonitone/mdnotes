import { FORMAT_SHORTCUTS } from './editor/format-commands';
import type { MessageKey } from '../shared/i18n';

/**
 * Model of the shortcut overview (Cmd+/). Pure data and formatting, so it is
 * unit-testable. Keep in sync with the native menu (src/main/index.ts), the
 * editor keymaps and F6 navigation.
 */

/** One key press. `mod` is Cmd on macOS and Ctrl elsewhere. */
export interface KeyStroke {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutEntry {
  /** Message key of the action name. */
  label: MessageKey;
  /** One stroke, or a sequence ("Esc, then Tab"). */
  keys: KeyStroke[];
}

export interface ShortcutGroup {
  title: MessageKey;
  entries: ShortcutEntry[];
}

export interface KeyNames {
  ctrl: string;
  shift: string;
  alt: string;
}

export function strokeLabel(stroke: KeyStroke, options: { mac: boolean; names: KeyNames }): string {
  const key = stroke.key.length === 1 ? stroke.key.toUpperCase() : stroke.key;
  if (options.mac) return `${stroke.alt ? '⌥' : ''}${stroke.shift ? '⇧' : ''}${stroke.mod ? '⌘' : ''}${key}`;
  const { ctrl, shift, alt } = options.names;
  return [...(stroke.mod ? [ctrl] : []), ...(stroke.alt ? [alt] : []), ...(stroke.shift ? [shift] : []), key].join('+');
}

/** `Esc, Tab` for a sequence, `⌘N` or `Ctrl+N` for a single stroke. */
export function keysLabel(keys: KeyStroke[], options: { mac: boolean; names: KeyNames }): string {
  return keys.map((stroke) => strokeLabel(stroke, options)).join(', ');
}

const format = (kind: keyof typeof FORMAT_SHORTCUTS): KeyStroke => ({ mod: true, ...FORMAT_SHORTCUTS[kind]! });

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'shortcuts.group.general',
    entries: [
      { label: 'menu.newNote', keys: [{ key: 'n', mod: true }] },
      { label: 'menu.chooseWorkspace', keys: [{ key: 'o', mod: true }] },
      { label: 'menu.find', keys: [{ key: 'f', mod: true }] },
      { label: 'menu.versions', keys: [{ key: 'v', mod: true, alt: true }] },
      { label: 'shortcuts.title', keys: [{ key: '/', mod: true }] },
    ],
  },
  {
    title: 'shortcuts.group.view',
    entries: [
      { label: 'editor.outline', keys: [{ key: 'o', mod: true, shift: true }] },
      { label: 'view.edit', keys: [{ key: '1', mod: true }] },
      { label: 'view.split', keys: [{ key: '2', mod: true }] },
      { label: 'view.preview', keys: [{ key: '3', mod: true }] },
    ],
  },
  {
    title: 'shortcuts.group.format',
    entries: [
      { label: 'format.bold', keys: [format('bold')] },
      { label: 'format.italic', keys: [format('italic')] },
      { label: 'format.link', keys: [format('link')] },
      { label: 'format.strike', keys: [format('strike')] },
      { label: 'shortcuts.tableNextCell', keys: [{ key: 'Tab' }] },
      { label: 'shortcuts.tablePreviousCell', keys: [{ key: 'Tab', shift: true }] },
      { label: 'shortcuts.tableNewRow', keys: [{ key: 'Enter' }] },
    ],
  },
  {
    title: 'shortcuts.group.navigation',
    entries: [
      { label: 'shortcuts.nextArea', keys: [{ key: 'F6' }] },
      { label: 'shortcuts.previousArea', keys: [{ key: 'F6', shift: true }] },
      { label: 'shortcuts.leaveEditor', keys: [{ key: 'Esc' }, { key: 'Tab' }] },
    ],
  },
];

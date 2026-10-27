import type { Command, KeyBinding } from '@codemirror/view';
import { applyFormat, type FormatKind, type FormatLabels, type FormatOutcome } from './format';

/** Shortcuts. `Mod` is Cmd on macOS and Ctrl elsewhere. */
export const FORMAT_SHORTCUTS: Partial<Record<FormatKind, { key: string; shift?: boolean }>> = {
  bold: { key: 'b' },
  italic: { key: 'i' },
  link: { key: 'k' },
  strike: { key: 'x', shift: true },
};

export interface FormatHooks {
  labels: () => FormatLabels;
  onFormat: (outcome: FormatOutcome) => void;
}

/** Formats the main selection. Returns false in a read-only editor. */
export function formatCommand(kind: FormatKind, hooks: FormatHooks): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    const outcome = applyFormat(view.state, kind, hooks.labels());
    view.dispatch({ ...outcome.spec, scrollIntoView: true, userEvent: 'input.format' });
    hooks.onFormat(outcome);
    return true;
  };
}

/**
 * Must come before the default keymap: Mod-i is "select parent syntax" there.
 * `preventDefault` keeps the browser from handling Ctrl+K and similar keys.
 */
export function formatKeymap(hooks: FormatHooks): KeyBinding[] {
  return (Object.entries(FORMAT_SHORTCUTS) as Array<[FormatKind, { key: string; shift?: boolean }]>).map(([kind, { key, shift }]) => ({
    key: `Mod-${shift ? 'Shift-' : ''}${key}`,
    run: formatCommand(kind, hooks),
    preventDefault: true,
  }));
}

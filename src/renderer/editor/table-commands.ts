import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';
import { editTable, isTableLine, type TableAction } from './table';

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

/** True when `pos` lies inside a GFM table node of the syntax tree (not in a code block that looks like one). */
function inTable(state: EditorState, pos: number): boolean {
  for (const side of [-1, 1] as const) {
    for (let node: Node | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
      if (node.name === 'Table') return true;
    }
  }
  return false;
}

/** Runs a table action at the caret. Returns false outside a table, so the default key binding applies. */
export function tableCommand(action: TableAction): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.readOnly || !range.empty || !inTable(state, range.head)) return false;

    const { doc } = state;
    const current = doc.lineAt(range.head);
    if (!isTableLine(current.text)) return false;
    let first = current.number;
    let last = current.number;
    while (first > 1 && isTableLine(doc.line(first - 1).text)) first--;
    while (last < doc.lines && isTableLine(doc.line(last + 1).text)) last++;

    const lines: string[] = [];
    for (let n = first; n <= last; n++) lines.push(doc.line(n).text);
    const edit = editTable(lines, current.number - first, range.head - current.from, action);
    if (!edit) return false;

    const from = doc.line(first).from;
    const to = doc.line(last).to;
    view.dispatch({
      // Skip the replacement when the table is already aligned, so undo history stays clean.
      changes: doc.sliceString(from, to) === edit.text ? undefined : { from, to, insert: edit.text },
      selection: EditorSelection.single(from + edit.from, from + edit.to),
      scrollIntoView: true,
      userEvent: 'input.table',
    });
    return true;
  };
}

/** Must run before the markdown and default keymaps, which bind Enter and Tab as well. */
export const tableKeymap: KeyBinding[] = [
  { key: 'Tab', run: tableCommand('next'), shift: tableCommand('previous') },
  { key: 'Enter', run: tableCommand('newRow') },
];

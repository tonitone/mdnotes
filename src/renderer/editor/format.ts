import { EditorSelection, type SelectionRange, type ChangeSet, type EditorState, type Line, type Text, type TransactionSpec } from '@codemirror/state';

/**
 * Markdown formatting as pure functions on an `EditorState`: they return the
 * transaction to dispatch and never touch the DOM, so unit tests run in Node.
 * Only the main selection range is formatted.
 */

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'heading' | 'list' | 'task' | 'table';

export interface FormatLabels {
  /** Header text of the generated table columns; a number is appended. */
  tableColumn: string;
}

export interface FormatOutcome {
  spec: TransactionSpec;
  kind: FormatKind;
  /** True when markers were added, false when they were removed. */
  on: boolean;
  /** Heading level after the change; 0 when the heading was removed. */
  level?: number;
}

export function applyFormat(state: EditorState, kind: FormatKind, labels: FormatLabels): FormatOutcome {
  switch (kind) {
    case 'bold':
    case 'italic':
    case 'strike':
      return toggleInline(state, kind);
    case 'code':
      return toggleCode(state);
    case 'link':
      return toggleLink(state);
    case 'heading':
      return cycleHeading(state);
    case 'list':
    case 'task':
      return toggleListKind(state, kind);
    case 'table':
      return insertTable(state, labels);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface Span {
  from: number;
  to: number;
}

interface Edit {
  from: number;
  to: number;
  insert: string;
}

const WORD = /[\p{L}\p{N}_]+/gu;
const WHITESPACE = /\s/;
/** Block prefix of a line: indentation, quote, list or task marker, heading marker. */
const BLOCK_PREFIX = /^\s*(?:>\s?)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/;

/** The word (letters, digits, underscore) that contains or touches `pos`, on one line. */
function wordAt(doc: Text, pos: number): Span | null {
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  for (const match of line.text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start <= offset && offset <= end) return { from: line.from + start, to: line.from + end };
  }
  return null;
}

/** Applies sorted edits (document coordinates) and returns them as a change set. */
function changeSet(state: EditorState, edits: Edit[]): ChangeSet {
  return state.changes([...edits].sort((a, b) => a.from - b.from));
}

/** Moves the main selection through the changes. */
function mapSelection(changes: ChangeSet, state: EditorState): EditorSelection | SelectionRange {
  const { from, to, empty, head } = state.selection.main;
  if (empty) return EditorSelection.cursor(changes.mapPos(head, 1));
  return EditorSelection.single(changes.mapPos(from, 1), changes.mapPos(to, -1));
}

/** Lines touched by the main selection; a selection that ends at a line start does not include that line. */
function selectedLines(doc: Text, from: number, to: number): Line[] {
  const first = doc.lineAt(from);
  let last = doc.lineAt(to);
  if (to > from && last.number > first.number && to === last.from) last = doc.line(last.number - 1);
  const lines: Line[] = [];
  for (let n = first.number; n <= last.number; n++) lines.push(doc.line(n));
  return lines;
}

/** Lines that carry text; a single blank line still counts so the caret can start a list there. */
function contentLines(lines: Line[]): Line[] {
  const filled = lines.filter((line) => line.text.trim() !== '');
  return filled.length > 0 ? filled : lines.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Bold, italic, strikethrough, inline code
// ---------------------------------------------------------------------------

interface Mark {
  char: string;
  size: number;
}

const MARKS: Record<'bold' | 'italic' | 'strike' | 'code', Mark> = {
  bold: { char: '*', size: 2 },
  italic: { char: '*', size: 1 },
  strike: { char: '~', size: 2 },
  code: { char: '`', size: 1 },
};

/** Number of `char` characters directly before (`step` -1) or from (`step` 1) `pos`, on that line. */
function runLength(doc: Text, pos: number, step: 1 | -1, char: string): number {
  const line = doc.lineAt(pos);
  let index = (step === 1 ? pos : pos - 1) - line.from;
  let count = 0;
  while (index >= 0 && index < line.length && line.text[index] === char) {
    count++;
    index += step;
  }
  return count;
}

/**
 * Whether the span is wrapped in the mark. Runs of the same character decide:
 * `**x**` is bold only, `*x*` italic only, `***x***` both.
 */
function isWrapped(mark: Mark, left: number, right: number): boolean {
  const run = Math.min(left, right);
  return mark.size === 1 && mark.char === '*' ? run % 2 === 1 : run >= mark.size;
}

/**
 * The text parts of a non-empty selection, one per line. Whitespace at the
 * ends, block prefixes (list markers, headings) and markers the selection
 * already includes are left out, so `**bold**` selected as a whole toggles
 * like `bold` selected.
 */
function selectionSegments(doc: Text, from: number, to: number, char: string | null): Span[] {
  const segments: Span[] = [];
  for (const line of selectedLines(doc, from, to)) {
    let a = Math.max(from, line.from);
    let b = Math.min(to, line.to);
    a = Math.max(a, line.from + (BLOCK_PREFIX.exec(line.text)?.[0].length ?? 0));
    while (a < b && WHITESPACE.test(doc.sliceString(a, a + 1))) a++;
    while (b > a && WHITESPACE.test(doc.sliceString(b - 1, b))) b--;
    if (a >= b) continue;
    if (char) {
      const text = doc.sliceString(a, b);
      let lead = 0;
      while (text[lead] === char) lead++;
      let trail = 0;
      while (text[text.length - 1 - trail] === char) trail++;
      // Each end on its own: after a multi-line toggle the selection holds the markers of the lines in between.
      if (lead + trail < text.length) {
        a += lead;
        b -= trail;
      }
    }
    segments.push({ from: a, to: b });
  }
  return segments;
}

function toggleInline(state: EditorState, kind: 'bold' | 'italic' | 'strike' | 'code'): FormatOutcome {
  const mark = MARKS[kind];
  const { doc } = state;
  const range = state.selection.main;
  const marker = mark.char.repeat(mark.size);

  let segments = range.empty ? [] : selectionSegments(doc, range.from, range.to, mark.char);
  if (segments.length === 0) {
    // A caret, or a selection without text: use the word at the caret.
    const word = wordAt(doc, range.head);
    if (word) segments = [word];
  }

  if (segments.length === 0) {
    // Nothing to wrap: insert an empty pair and put the caret inside, or remove an empty pair.
    const pos = range.head;
    if (isWrapped(mark, runLength(doc, pos, -1, mark.char), runLength(doc, pos, 1, mark.char))) {
      const changes = changeSet(state, [
        { from: pos - mark.size, to: pos, insert: '' },
        { from: pos, to: pos + mark.size, insert: '' },
      ]);
      return { kind, on: false, spec: { changes, selection: EditorSelection.cursor(pos - mark.size) } };
    }
    return {
      kind,
      on: true,
      spec: { changes: { from: pos, insert: marker + marker }, selection: EditorSelection.cursor(pos + mark.size) },
    };
  }

  const wrapped = segments.map((s) => isWrapped(mark, runLength(doc, s.from, -1, mark.char), runLength(doc, s.to, 1, mark.char)));
  const remove = wrapped.every(Boolean);
  const edits: Edit[] = [];
  segments.forEach((s, i) => {
    if (remove) {
      edits.push({ from: s.from - mark.size, to: s.from, insert: '' }, { from: s.to, to: s.to + mark.size, insert: '' });
    } else if (!wrapped[i]) {
      edits.push({ from: s.from, to: s.from, insert: marker }, { from: s.to, to: s.to, insert: marker });
    }
  });
  const changes = changeSet(state, edits);

  let selection: EditorSelection | SelectionRange;
  if (range.empty || !selectionIsText(doc, range)) {
    // Keep the caret where it was in the word, inside the markers at both ends.
    const word = segments[0];
    const assoc = range.head === word.to && range.head !== word.from ? -1 : 1;
    selection = EditorSelection.cursor(changes.mapPos(range.head, assoc));
  } else {
    selection = EditorSelection.single(changes.mapPos(segments[0].from, 1), changes.mapPos(segments[segments.length - 1].to, -1));
  }
  return { kind, on: !remove, spec: { changes, selection } };
}

/** False for a selection that only covers whitespace or block prefixes. */
function selectionIsText(doc: Text, range: { from: number; to: number; empty: boolean }): boolean {
  return !range.empty && selectionSegments(doc, range.from, range.to, null).length > 0;
}

// ---------------------------------------------------------------------------
// Code: inline span or fenced block
// ---------------------------------------------------------------------------

const FENCE = '```';

/** True when `line` is the opening fence of a block: it starts with a fence and an odd number of fences precede it. */
function opensFence(doc: Text, line: Line): boolean {
  if (!line.text.startsWith(FENCE)) return false;
  let fences = 0;
  for (let n = 1; n <= line.number; n++) if (doc.line(n).text.startsWith(FENCE)) fences++;
  return fences % 2 === 1;
}

function toggleCode(state: EditorState): FormatOutcome {
  const { doc } = state;
  const range = state.selection.main;
  const lines = selectedLines(doc, range.from, range.to);
  const first = lines[0];
  const last = lines[lines.length - 1];
  const before = first.number > 1 ? doc.line(first.number - 1) : null;
  const after = last.number < doc.lines ? doc.line(last.number + 1) : null;
  if (before && after && opensFence(doc, before) && after.text.trim() === FENCE) {
    // The lines sit between two fences: remove the fences, keep the text.
    const changes = changeSet(state, [
      { from: before.from, to: before.to + 1, insert: '' },
      // The closing fence goes together with the line break in front of it.
      { from: after.from - 1, to: after.to, insert: '' },
    ]);
    return { kind: 'code', on: false, spec: { changes, selection: mapSelection(changes, state) } };
  }

  const blankCaret = range.empty && first.text.trim() === '';
  if (lines.length === 1 && !blankCaret) return toggleInline(state, 'code');
  if (blankCaret) {
    const insert = `${FENCE}\n\n${FENCE}`;
    return {
      kind: 'code',
      on: true,
      spec: { changes: { from: first.from, to: first.to, insert }, selection: EditorSelection.cursor(first.from + FENCE.length + 1) },
    };
  }
  const changes = changeSet(state, [
    { from: first.from, to: first.from, insert: `${FENCE}\n` },
    { from: last.to, to: last.to, insert: `\n${FENCE}` },
  ]);
  return {
    kind: 'code',
    on: true,
    spec: { changes, selection: EditorSelection.single(changes.mapPos(first.from, 1), changes.mapPos(last.to, -1)) },
  };
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

const LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g;
const URL_LIKE = /^(?:https?:\/\/|mailto:)\S+$/i;
const URL_PLACEHOLDER = 'url';

function toggleLink(state: EditorState): FormatOutcome {
  const { doc } = state;
  const range = state.selection.main;
  const line = doc.lineAt(range.from);
  const sameLine = range.to <= line.to;

  // Inside a link: remove the link syntax and keep the text (images are left alone).
  if (sameLine) {
    for (const match of line.text.matchAll(LINK)) {
      const start = line.from + (match.index ?? 0);
      const end = start + match[0].length;
      if (range.from < start || range.to > end) continue;
      // An image is not a link: do nothing instead of nesting brackets in its alt text.
      if (match[1]) return { kind: 'link', on: false, spec: {} };
      const text = match[2];
      const textStart = start + 1;
      const caret = Math.min(Math.max(range.head, textStart), textStart + text.length) - 1;
      const selection = range.empty ? EditorSelection.cursor(caret) : EditorSelection.single(start, start + text.length);
      return { kind: 'link', on: false, spec: { changes: { from: start, to: end, insert: text }, selection } };
    }
  }

  let target: Span | null = null;
  if (sameLine && !range.empty) {
    const segments = selectionSegments(doc, range.from, range.to, null);
    if (segments.length === 1) target = segments[0];
  } else if (range.empty) {
    target = wordAt(doc, range.head);
  }

  if (!target) {
    // No text to link: insert an empty link and put the caret into the brackets.
    return {
      kind: 'link',
      on: true,
      spec: { changes: { from: range.head, insert: '[]()' }, selection: EditorSelection.cursor(range.head + 1) },
    };
  }

  const text = doc.sliceString(target.from, target.to);
  if (URL_LIKE.test(text)) {
    // A pasted address becomes the target; the caret waits in the empty text part.
    const changes = changeSet(state, [
      { from: target.from, to: target.from, insert: '[](' },
      { from: target.to, to: target.to, insert: ')' },
    ]);
    return { kind: 'link', on: true, spec: { changes, selection: EditorSelection.cursor(target.from + 1) } };
  }
  const changes = changeSet(state, [
    { from: target.from, to: target.from, insert: '[' },
    { from: target.to, to: target.to, insert: `](${URL_PLACEHOLDER})` },
  ]);
  // Select the placeholder so typing or pasting replaces it.
  const urlFrom = changes.mapPos(target.to, 1) - URL_PLACEHOLDER.length - 1;
  return { kind: 'link', on: true, spec: { changes, selection: EditorSelection.single(urlFrom, urlFrom + URL_PLACEHOLDER.length) } };
}

// ---------------------------------------------------------------------------
// Heading, list, task
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})[ \t]+/;
const MAX_CYCLE_LEVEL = 3;

/** Level 1, 2, 3, then off, for every selected line; deeper headings go off. */
function cycleHeading(state: EditorState): FormatOutcome {
  const { doc } = state;
  const range = state.selection.main;
  const lines = contentLines(selectedLines(doc, range.from, range.to));
  const current = HEADING.exec(lines[0].text)?.[1].length ?? 0;
  const level = current >= MAX_CYCLE_LEVEL ? 0 : current + 1;
  const edits = lines.map((line): Edit => {
    const existing = HEADING.exec(line.text)?.[0].length ?? 0;
    return { from: line.from, to: line.from + existing, insert: level > 0 ? `${'#'.repeat(level)} ` : '' };
  });
  const changes = changeSet(state, edits);
  return { kind: 'heading', on: level > 0, level, spec: { changes, selection: mapSelection(changes, state) } };
}

type ListType = 'none' | 'bullet' | 'task' | 'ordered';

const LIST_MARKER = /^(\s*)((?:([-*+])|(\d{1,9}[.)]))[ \t]+(\[[ xX]\][ \t]+)?)?/;

function listInfo(text: string): { indent: number; markerLength: number; type: ListType } {
  const match = LIST_MARKER.exec(text);
  const indent = match?.[1].length ?? 0;
  const marker = match?.[2] ?? '';
  let type: ListType = 'none';
  if (marker) type = match?.[5] ? 'task' : match?.[3] ? 'bullet' : 'ordered';
  return { indent, markerLength: marker.length, type };
}

/** Switches the selected lines to a bullet list or task list, or back to plain text. */
function toggleListKind(state: EditorState, kind: 'list' | 'task'): FormatOutcome {
  const { doc } = state;
  const range = state.selection.main;
  const lines = contentLines(selectedLines(doc, range.from, range.to));
  const info = lines.map((line) => listInfo(line.text));
  const wanted: ListType = kind === 'list' ? 'bullet' : 'task';
  const remove = info.every((i) => i.type === wanted);
  const marker = kind === 'list' ? '- ' : '- [ ] ';

  const edits: Edit[] = [];
  lines.forEach((line, i) => {
    const { indent, markerLength, type } = info[i];
    if (remove) edits.push({ from: line.from + indent, to: line.from + indent + markerLength, insert: '' });
    // Lines that already are tasks keep their state when the task button is used on a mixed selection.
    else if (type !== wanted) edits.push({ from: line.from + indent, to: line.from + indent + markerLength, insert: marker });
  });
  const changes = changeSet(state, edits);
  return { kind, on: !remove, spec: { changes, selection: mapSelection(changes, state) } };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/** Inserts a table with two columns after the selected lines and selects the first header cell. */
function insertTable(state: EditorState, labels: FormatLabels): FormatOutcome {
  const { doc } = state;
  const range = state.selection.main;
  const line = selectedLines(doc, range.from, range.to).at(-1)!;
  const header = `${labels.tableColumn} 1`;
  const table = `| ${header} | ${labels.tableColumn} 2 |\n| --- | --- |\n|  |  |`;
  const previous = line.number > 1 ? doc.line(line.number - 1) : null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const blankLine = line.text.trim() === '';

  // A table needs a blank line before it, and one after it unless the text ends.
  let prefix: string;
  if (blankLine) prefix = previous && previous.text.trim() !== '' ? '\n' : '';
  else prefix = '\n\n';
  const suffix = next && next.text.trim() !== '' ? '\n' : '';
  // A blank line is replaced, text is followed by the table.
  const from = blankLine ? line.from : line.to;
  const to = line.to;

  const start = from + prefix.length + 2;
  return {
    kind: 'table',
    on: true,
    spec: {
      changes: { from, to, insert: prefix + table + suffix },
      selection: EditorSelection.single(start, start + header.length),
    },
  };
}

// ---------------------------------------------------------------------------
// Shortcut labels
// ---------------------------------------------------------------------------

export interface ShortcutNames {
  /** Name of the primary modifier outside macOS, e.g. "Ctrl" or "Strg". */
  ctrl: string;
  shift: string;
}

/** Display text of a shortcut: `⇧⌘X` on macOS, `Ctrl+Shift+X` elsewhere. */
export function shortcutLabel(key: string, options: { mac: boolean; shift?: boolean; names: ShortcutNames }): string {
  const upper = key.toUpperCase();
  if (options.mac) return `${options.shift ? '⇧' : ''}⌘${upper}`;
  return [options.names.ctrl, ...(options.shift ? [options.names.shift] : []), upper].join('+');
}

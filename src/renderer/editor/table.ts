/**
 * GFM table editing as pure string functions (no CodeMirror), so the unit
 * tests run in Node. `table-commands.ts` connects them to the editor.
 */

export type TableAction = 'next' | 'previous' | 'newRow';

export interface TableEdit {
  /** The re-aligned table, lines joined with "\n". */
  text: string;
  /** Selection inside `text`: the content of the target cell, or a caret when it is empty. */
  from: number;
  to: number;
}

/** `marked` is a left alignment written as `:---`; `left` is the unmarked default. */
type Align = 'left' | 'marked' | 'right' | 'center';

interface Row {
  indent: string;
  cells: string[];
}

const UNESCAPED_PIPE = /(?<!\\)\|/g;
const DELIMITER_CELL = /^:?-+:?$/;

/** A line that can belong to a table: optional indent, then a leading pipe. */
export function isTableLine(text: string): boolean {
  return /^\s*\|/.test(text);
}

function parseRow(text: string): Row {
  const indent = /^\s*/.exec(text)![0];
  let body = text.slice(indent.length).replace(/\s+$/, '');
  if (body.startsWith('|')) body = body.slice(1);
  if (/(?<!\\)\|$/.test(body)) body = body.slice(0, -1);
  return { indent, cells: body.split(UNESCAPED_PIPE).map((cell) => cell.trim()) };
}

export function isDelimiterRow(text: string): boolean {
  return isTableLine(text) && parseRow(text).cells.every((cell) => DELIMITER_CELL.test(cell));
}

const length = (text: string) => [...text].length;

function alignOf(cell: string | undefined): Align {
  if (!cell) return 'left';
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return left ? 'marked' : 'left';
}

/** Index of the cell under `offset` in `text`: pipes before the offset, minus the leading one. */
function columnAt(text: string, offset: number): number {
  const before = text.slice(0, Math.max(0, offset));
  const pipes = (before.match(UNESCAPED_PIPE) ?? []).length;
  return Math.max(0, pipes - 1);
}

function pad(text: string, width: number, align: Align): string {
  const gap = width - length(text);
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
  return text + ' '.repeat(gap);
}

/**
 * Applies `action` to the table made of `lines`, with the caret in `lines[row]` at `offset`.
 * Returns the aligned table and the new selection, or null when `lines` is not a table
 * (a table needs a header row and a delimiter row).
 */
export function editTable(lines: string[], row: number, offset: number, action: TableAction): TableEdit | null {
  if (lines.length < 2 || !lines.every(isTableLine) || !isDelimiterRow(lines[1]!)) return null;
  const rows = lines.map(parseRow);
  const columns = Math.max(1, ...rows.map((r) => r.cells.length));
  const aligns: Align[] = Array.from({ length: columns }, (_, i) => alignOf(rows[1]!.cells[i]));
  const indent = rows[0]!.indent;

  // The delimiter row has no editable cells: treat the caret there as being in the header.
  const current = row === 1 ? 0 : row;
  const column = Math.min(columns - 1, columnAt(lines[row]!, offset));

  let targetRow = current;
  let targetColumn = column;
  const body: string[][] = rows.map((r, i) => (i === 1 ? [] : Array.from({ length: columns }, (_, c) => r.cells[c] ?? '')));

  if (action === 'next') {
    if (column + 1 < columns) targetColumn = column + 1;
    else {
      targetColumn = 0;
      targetRow = current === 0 ? 2 : current + 1;
      if (targetRow >= rows.length) {
        body.push(Array.from({ length: columns }, () => ''));
        rows.push({ indent, cells: [] });
      }
    }
  } else if (action === 'previous') {
    if (column > 0) targetColumn = column - 1;
    else if (current > 0) {
      targetColumn = columns - 1;
      targetRow = current === 2 ? 0 : current - 1;
    }
  } else {
    // A new row goes below the current one; below the header it goes below the delimiter row.
    targetRow = current === 0 ? 2 : current + 1;
    targetColumn = 0;
    body.splice(targetRow, 0, Array.from({ length: columns }, () => ''));
    rows.splice(targetRow, 0, { indent, cells: [] });
  }

  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...body.filter((cells) => cells.length > 0).map((cells) => length(cells[c]!))),
  );

  const out: string[] = [];
  let from = 0;
  let to = 0;
  let lineStart = 0;
  body.forEach((cells, r) => {
    let line: string;
    if (r === 1) {
      line = `${indent}| ${widths.map((w, c) => delimiter(w, aligns[c]!)).join(' | ')} |`;
    } else {
      const padded = cells.map((cell, c) => pad(cell, widths[c]!, aligns[c]!));
      line = `${indent}| ${padded.join(' | ')} |`;
      if (r === targetRow) {
        let start = lineStart + indent.length + 2;
        // Measure the rendered cells: surrogate pairs make them longer than their code point width.
        for (let c = 0; c < targetColumn; c++) start += padded[c]!.length + 3;
        const cell = cells[targetColumn]!;
        const lead = padded[targetColumn]!.length - padded[targetColumn]!.trimStart().length;
        from = start + (cell === '' ? 0 : lead);
        to = from + cell.length;
      }
    }
    out.push(line);
    lineStart += line.length + 1;
  });
  return { text: out.join('\n'), from, to };
}

function delimiter(width: number, align: Align): string {
  if (align === 'center') return `:${'-'.repeat(width - 2)}:`;
  if (align === 'right') return `${'-'.repeat(width - 1)}:`;
  if (align === 'marked') return `:${'-'.repeat(width - 1)}`;
  return '-'.repeat(width);
}

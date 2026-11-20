/**
 * Finds TeX math in Markdown source: `$...$` inside a line and `$$` blocks.
 * Pure text scanning, no dependencies. Callers skip matches that lie inside
 * code (they know the syntax tree, this module does not).
 */

export interface BlockMath {
  /** Zero-based index of the line that holds the opening `$$`. */
  start: number;
  /** Zero-based index of the line that holds the closing `$$` (same as `start` for one-liners). */
  end: number;
  tex: string;
}

export interface InlineMath {
  from: number;
  to: number;
  tex: string;
}

const OPEN_RE = /^\s{0,3}\$\$(.*)$/;

/**
 * `$$ x $$` on one line, or `$$` ... `$$` over several lines. The closing
 * `$$` must end its line. An unclosed block is not math.
 */
export function findBlockMath(lines: readonly string[]): BlockMath[] {
  const out: BlockMath[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN_RE.exec(lines[i]);
    if (!open) continue;
    const rest = open[1];
    const oneLine = /^(.*?)\$\$\s*$/.exec(rest);
    if (oneLine) {
      const tex = oneLine[1].trim();
      if (tex) out.push({ start: i, end: i, tex });
      continue;
    }
    const body = [rest];
    for (let j = i + 1; j < lines.length; j++) {
      const close = /^(.*?)\$\$\s*$/.exec(lines[j]);
      if (close) {
        body.push(close[1]);
        const tex = body.join('\n').trim();
        if (tex) out.push({ start: i, end: j, tex });
        i = j;
        break;
      }
      body.push(lines[j]);
    }
  }
  return out;
}

/**
 * `$x^2$` in one line. The opening `$` must not be followed by a space and the
 * closing one not preceded by one or followed by a word character, so prices
 * such as "$5 and $6" stay text. `\$` is a literal dollar sign.
 */
const INLINE_RE = /(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\w$])/g;

export function findInlineMath(line: string): InlineMath[] {
  const out: InlineMath[] = [];
  for (const m of line.matchAll(INLINE_RE)) {
    out.push({ from: m.index!, to: m.index! + m[0].length, tex: m[1] });
  }
  return out;
}

/** `[^id]` references and `[^id]:` definition labels in one line. */
export interface FootnoteMark {
  from: number;
  to: number;
  definition: boolean;
}

export function findFootnoteMarks(line: string): FootnoteMark[] {
  const out: FootnoteMark[] = [];
  const def = /^\s{0,3}\[\^[^\s\]]+\]:/.exec(line);
  const defEnd = def ? def[0].length : 0;
  if (def) out.push({ from: def[0].indexOf('['), to: defEnd - 1, definition: true });
  for (const m of line.matchAll(/\[\^[^\s\]]+\](?!\()/g)) {
    const from = m.index!;
    if (def && from < defEnd) continue;
    out.push({ from, to: from + m[0].length, definition: false });
  }
  return out;
}

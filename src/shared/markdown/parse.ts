/**
 * Small, dependency-free Markdown parser for exports (wiki markup, HTML/PDF).
 *
 * It covers what the editor produces: ATX headings, paragraphs, fenced code,
 * block quotes, nested bullet/ordered/task lists, GFM tables, horizontal
 * rules and the common inline syntax. It is not a full CommonMark
 * implementation; unknown constructs fall back to plain text.
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'em' | 'strike'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export interface ListItem {
  /** Marker path from the outermost list, e.g. ['bullet', 'ordered']. */
  path: Array<'bullet' | 'ordered'>;
  /** `null` for normal items, otherwise the checkbox state. */
  checked: boolean | null;
  content: Inline[];
}

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; align: Array<'left' | 'center' | 'right' | null>; rows: Inline[][][] }
  | { type: 'hr' };

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += s[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || LIST_RE.test(line) || QUOTE_RE.test(line);
}

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or end of input)
      blocks.push({ type: 'code', lang: fence[3] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: parseInline(heading[2] ?? '') });
      i++;
      continue;
    }

    // Checked before lists: "- - -" and "* * *" are rules, not list items.
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const q = QUOTE_RE.exec(lines[i]);
        inner.push(q ? q[1] : lines[i]);
        i++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner) });
      continue;
    }

    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }

    const para: Inline[][] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) {
      para.push(parseInline(lines[i].trim()));
      i++;
    }
    blocks.push({ type: 'paragraph', lines: para });
  }
  return blocks;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const items: ListItem[] = [];
  // Stack of open lists: indentation of their markers and their kind.
  const stack: Array<{ indent: number; kind: 'bullet' | 'ordered' }> = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // A blank line continues the list only if another item follows.
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && LIST_RE.test(lines[j])) {
        i = j;
        continue;
      }
      break;
    }

    const m = LIST_RE.exec(line);
    if (!m) {
      // Indented continuation line of the previous item.
      if (items.length > 0 && /^\s+\S/.test(line)) {
        items[items.length - 1].content.push({ type: 'break' }, ...parseInline(line.trim()));
        i++;
        continue;
      }
      break;
    }

    const indent = indentWidth(m[1]);
    const kind = /\d/.test(m[2]) ? 'ordered' : 'bullet';
    while (stack.length > 0 && indent < stack[stack.length - 1].indent) stack.pop();
    if (stack.length === 0 || indent > stack[stack.length - 1].indent) {
      stack.push({ indent, kind });
    } else {
      stack[stack.length - 1].kind = kind;
    }

    let text = m[3];
    let checked: boolean | null = null;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task && kind === 'bullet') {
      checked = task[1] !== ' ';
      text = task[2];
    }
    items.push({ path: stack.map((s) => s.kind), checked, content: parseInline(text) });
    i++;
  }
  return { block: { type: 'list', items }, next: i };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>';

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

/** Finds the closing bracket that matches the opening one at `open`. */
function findClosingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
    } else if (s[i] === '[') {
      depth++;
    } else if (s[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses `(url "title")` at `start`, returns the URL and the end index. */
function parseLinkTarget(s: string, start: number): { url: string; end: number } | null {
  if (s[start] !== '(') return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
    } else if (s[i] === '(') {
      depth++;
    } else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        let inner = s.slice(start + 1, i).trim();
        inner = inner.replace(/\s+("[^"]*"|'[^']*')$/, '');
        if (inner.startsWith('<') && inner.endsWith('>')) inner = inner.slice(1, -1);
        return { url: inner, end: i + 1 };
      }
    }
  }
  return null;
}

/** Finds the closing delimiter run for emphasis, skipping code spans. */
function findClosing(s: string, from: number, delim: string): number {
  for (let i = from; i <= s.length - delim.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) i = end;
      continue;
    }
    if (s.startsWith(delim, i) && s[i - 1] !== ' ' && i > from) {
      // `*` inside `**` must not close a single-star run.
      if (delim.length === 1 && s[i + 1] === delim) {
        i++;
        continue;
      }
      if (delim === '_' && isWordChar(s[i + 1])) continue;
      return i;
    }
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', value: text });
    text = '';
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (s[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const end = s.indexOf(fence, i + run);
      if (end !== -1) {
        flush();
        out.push({ type: 'code', value: s.slice(i + run, end).replace(/^ (.*) $/, '$1') });
        i = end + run;
        continue;
      }
      text += fence;
      i += run;
      continue;
    }

    if (ch === '!' && s[i + 1] === '[') {
      const close = findClosingBracket(s, i + 1);
      const target = close !== -1 ? parseLinkTarget(s, close + 1) : null;
      if (target) {
        flush();
        out.push({ type: 'image', alt: s.slice(i + 2, close), src: target.url });
        i = target.end;
        continue;
      }
    }

    if (ch === '[') {
      const close = findClosingBracket(s, i);
      const target = close !== -1 ? parseLinkTarget(s, close + 1) : null;
      if (target) {
        flush();
        out.push({ type: 'link', href: target.url, children: parseInline(s.slice(i + 1, close)) });
        i = target.end;
        continue;
      }
    }

    if (ch === '<') {
      const m = /^<((?:https?|mailto):[^\s>]+)>/.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ type: 'link', href: m[1], children: [{ type: 'text', value: m[1] }] });
        i += m[0].length;
        continue;
      }
    }

    const delims: Array<[string, 'strong' | 'em' | 'strike']> = [
      ['**', 'strong'],
      ['__', 'strong'],
      ['~~', 'strike'],
      ['*', 'em'],
      ['_', 'em'],
    ];
    let matched = false;
    for (const [d, type] of delims) {
      if (!s.startsWith(d, i)) continue;
      const after = s[i + d.length];
      if (!after || after === ' ') continue;
      if (d[0] === '_' && isWordChar(s[i - 1])) continue; // no intraword underscore emphasis
      const end = findClosing(s, i + d.length, d);
      if (end === -1) continue;
      flush();
      out.push({ type, children: parseInline(s.slice(i + d.length, end)) });
      i = end + d.length;
      matched = true;
      break;
    }
    if (matched) continue;

    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Plain text of inline content (for alt texts, titles, table widths). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.value;
        case 'image':
          return n.alt;
        case 'break':
          return ' ';
        default:
          return inlineText(n.children);
      }
    })
    .join('');
}

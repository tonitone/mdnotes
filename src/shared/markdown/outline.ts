import { inlineText, parseInline } from './parse';

/** One heading of a note. */
export interface OutlineEntry {
  /** 1 to 6. */
  level: number;
  /** Plain text of the heading, without inline markup. */
  text: string;
  /** Character offset of the start of the heading line in the document. */
  offset: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*(?:#+[ \t]*)?$/;

/**
 * Lists the ATX headings of a document in order. Lines inside fenced code
 * blocks are ignored, and so are empty headings.
 */
export function extractOutline(doc: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of doc.split('\n')) {
    const lineOffset = offset;
    offset += line.length + 1;
    const text = line.replace(/\r$/, '');
    const open = FENCE_RE.exec(text);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && text.trim() === open[1]) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    const heading = HEADING_RE.exec(text);
    if (!heading) continue;
    const label = inlineText(parseInline(heading[2] ?? '')).trim();
    if (label) entries.push({ level: heading[1].length, text: label, offset: lineOffset });
  }
  return entries;
}

/**
 * Core logic of a note: identity (ULID), file name, title and front matter.
 *
 * Deliberately free of dependencies and of Node or DOM APIs except `crypto`,
 * so the same code runs in the Electron main process, in browser mode and in
 * tests.
 */

export const UNTITLED = 'Neue Notiz';

/** Front matter fields managed by the app itself. */
export interface NoteMeta {
  id: string;
  labels: string[];
  created: string;
}

export interface ParsedNote {
  /** Only set if the front matter contained a valid ID. */
  meta: Partial<NoteMeta>;
  /** Foreign front matter lines, kept verbatim. */
  extraFrontMatter: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// ULID: 10 chars timestamp + 16 chars randomness, Crockford base32.
// Sortable by creation time, no dependency.
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isNoteId(value: unknown): value is string {
  return typeof value === 'string' && ULID_RE.test(value);
}

export function newId(now: number = Date.now()): string {
  let time = '';
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return time + rand;
}

// ---------------------------------------------------------------------------
// File name: "title-as-slug--a3f9k2.md". The slug is for display only;
// uniqueness comes from the last 6 characters of the ID.
// ---------------------------------------------------------------------------

const SLUG_MAX = 60;
const UMLAUTS: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss',
};

export function slugify(title: string): string {
  const slug = title
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || 'notiz';
}

export function idSuffix(id: string): string {
  return id.slice(-6).toLowerCase();
}

export function fileNameFor(title: string, id: string): string {
  return `${slugify(title)}--${idSuffix(id)}.md`;
}

// ---------------------------------------------------------------------------
// Title and preview: the title is the first non-empty line.
// ---------------------------------------------------------------------------

const TITLE_MAX = 120;

/** Strips Markdown markup from a single line. */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '') // heading
    .replace(/^\s*>\s?/, '') // quote
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '') // list item, task
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link
    .replace(/(\*\*|__|~~|\*|_|`)/g, '')
    .trim();
}

export function titleFromBody(body: string): string {
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) break; // a code block is not a title
    const plain = plainLine(line);
    if (plain) return plain.slice(0, TITLE_MAX);
  }
  return UNTITLED;
}

export function previewFromBody(body: string, max = 140): string {
  const lines = body.split('\n');
  let seenTitle = false;
  const parts: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) continue;
    const plain = plainLine(line);
    if (!plain) continue;
    if (!seenTitle) {
      seenTitle = true;
      continue;
    }
    parts.push(plain);
    if (parts.join(' ').length >= max) break;
  }
  const text = parts.join(' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

// ---------------------------------------------------------------------------
// Front matter. The app only reads and writes `id`, `labels` and `created`.
// All other lines are kept character for character, so foreign YAML is
// never reformatted.
// ---------------------------------------------------------------------------

const OWN_KEYS = new Set(['id', 'labels', 'created']);

export function normalizeText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseFlowList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
}

export function parseNote(raw: string): ParsedNote {
  const text = normalizeText(raw);
  const empty: ParsedNote = { meta: {}, extraFrontMatter: [], body: text };
  if (!text.startsWith('---\n')) return empty;

  const end = text.indexOf('\n---', 3);
  if (end === -1) return empty;
  const afterFence = text.indexOf('\n', end + 4);
  const closing = text.slice(end + 1, afterFence === -1 ? undefined : afterFence);
  if (closing.trim() !== '---') return empty;

  const fmLines = text.slice(4, end).split('\n');
  const body = afterFence === -1 ? '' : text.slice(afterFence + 1);
  const meta: Partial<NoteMeta> = {};
  const extra: string[] = [];

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!m || !OWN_KEYS.has(m[1])) {
      extra.push(line);
      continue;
    }
    const [, key, rest] = m;
    if (key === 'id') {
      const id = unquote(rest);
      if (isNoteId(id)) meta.id = id;
    } else if (key === 'created') {
      meta.created = unquote(rest);
    } else if (key === 'labels') {
      if (rest.trim().startsWith('[')) {
        meta.labels = parseFlowList(rest);
      } else {
        const labels: string[] = [];
        while (i + 1 < fmLines.length && /^\s+-\s*/.test(fmLines[i + 1])) {
          i++;
          const label = unquote(fmLines[i].replace(/^\s+-\s*/, ''));
          if (label) labels.push(label);
        }
        meta.labels = labels;
      }
    }
  }
  return { meta, extraFrontMatter: extra, body };
}

function quoteIfNeeded(value: string): string {
  return /^[\p{L}\p{N}_./ -]+$/u.test(value) && value.trim() === value
    ? value
    : JSON.stringify(value);
}

export function serializeNote(meta: NoteMeta, body: string, extraFrontMatter: string[] = []): string {
  const labels = meta.labels.map(quoteIfNeeded).join(', ');
  const lines = [
    '---',
    `id: ${meta.id}`,
    `labels: [${labels}]`,
    `created: ${meta.created}`,
    ...extraFrontMatter.filter((l, i, all) => !(i === all.length - 1 && l.trim() === '')),
    '---',
  ];
  return lines.join('\n') + '\n' + normalizeText(body);
}

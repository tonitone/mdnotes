/**
 * Links between notes: `[[<id>|<title>]]`.
 *
 * The link is bound to the note ID (ULID), so renaming the target never
 * breaks it. The title after `|` is only a readable fallback in the plain
 * file; the editor shows the current title of the target.
 */

const ID = '[0-9A-HJKMNP-TV-Z]{26}';

export interface WikiLink {
  /** Start of `[[` in the text. */
  from: number;
  /** End after `]]`. */
  to: number;
  id: string;
  /** Title as written in the file. */
  alias: string;
}

function linkRegex(): RegExp {
  return new RegExp(`\\[\\[(${ID})\\|([^\\]\\n]*)\\]\\]`, 'g');
}

/** Removes characters that would end or break a link label. */
export function cleanLinkTitle(title: string): string {
  return title.replace(/[[\]|\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatWikiLink(id: string, title: string): string {
  return `[[${id}|${cleanLinkTitle(title)}]]`;
}

export function findWikiLinks(text: string): WikiLink[] {
  return [...text.matchAll(linkRegex())].map((m) => ({
    from: m.index ?? 0,
    to: (m.index ?? 0) + m[0].length,
    id: m[1],
    alias: m[2],
  }));
}

/** Whether `body` links to the note `id`. */
export function linksTo(body: string, id: string): boolean {
  return body.includes(`[[${id}|`) && findWikiLinks(body).some((l) => l.id === id);
}

/** Plain text for previews and exports: each link becomes its title. */
export function wikiLinksToText(text: string, titleOf?: (id: string) => string | undefined): string {
  if (!text.includes('[[')) return text;
  return text.replace(linkRegex(), (_all, id: string, alias: string) => titleOf?.(id) || alias || id);
}

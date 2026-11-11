/**
 * Order and date groups of the note list, like Apple Notes: pinned notes
 * first, then Today, Yesterday, Previous 7 Days, Previous 30 Days, the
 * months of the current year and the years before.
 *
 * Pure functions without dependencies (only the built-in `Intl`), with an
 * injected "now" and time zone, so they are testable at day, month and year
 * boundaries.
 */

export type NoteSort = 'modified' | 'created' | 'title';
export const NOTE_SORTS: readonly NoteSort[] = ['modified', 'created', 'title'];
export const DEFAULT_NOTE_SORT: NoteSort = 'modified';

export function isNoteSort(value: unknown): value is NoteSort {
  return typeof value === 'string' && (NOTE_SORTS as readonly string[]).includes(value);
}

/** The fields of a note the list needs for ordering and grouping. */
export interface ListedNote {
  id: string;
  title: string;
  /** Last modification, milliseconds since the epoch. */
  modified: number;
  /** ISO date from the front matter; may be hand-written or invalid. */
  created: string;
  pinned: boolean;
}

/** Creation time in milliseconds; an unreadable `created` falls back to the modification time. */
export function createdTime(note: Pick<ListedNote, 'created' | 'modified'>): number {
  const time = Date.parse(note.created);
  return Number.isFinite(time) ? time : note.modified;
}

function dateFor(note: ListedNote, sort: NoteSort): number {
  return sort === 'created' ? createdTime(note) : note.modified;
}

/**
 * Pinned notes first, then by the chosen order: newest first for the dates,
 * A to Z for the title (numbers in natural order, case and accents ignored).
 * Returns a new array.
 */
export function sortNotes<T extends ListedNote>(notes: readonly T[], sort: NoteSort, locale?: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);
  const byDate = (a: T, b: T) => dateFor(b, sort) - dateFor(a, sort);
  return [...notes].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (sort === 'title' ? byTitle(a, b) || b.modified - a.modified : byDate(a, b) || byTitle(a, b)) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

export type DateGroup =
  | { kind: 'pinned' }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'previous7' }
  | { kind: 'previous30' }
  /** A month of the current year; `month` is 1 to 12. */
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number };

export interface NoteGroup<T> {
  /** Stable key, e.g. `today`, `month-2026-03`, `year-2024`. */
  key: string;
  group: DateGroup;
  notes: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date of a moment in a time zone (`undefined` = the system's). */
function calendarDate(time: number, timeZone?: string): { year: number; month: number; day: number } {
  const key = timeZone ?? '';
  let formatter = partsFormatters.get(key);
  if (!formatter) {
    // en-US with Latin digits only to read the numbers; nothing is shown to the user.
    formatter = new Intl.DateTimeFormat('en-US-u-nu-latn-ca-gregory', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    partsFormatters.set(key, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** Days since the epoch of a calendar date; differences are whole days, also across DST changes. */
function dayNumber(date: { year: number; month: number; day: number }): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
}

/** The date group of a moment, seen from `now`. A date in the future counts as today. */
export function dateGroup(time: number, now: number, timeZone?: string): DateGroup {
  const date = calendarDate(time, timeZone);
  const today = calendarDate(now, timeZone);
  const daysAgo = dayNumber(today) - dayNumber(date);
  if (daysAgo <= 0) return { kind: 'today' };
  if (daysAgo === 1) return { kind: 'yesterday' };
  if (daysAgo <= 7) return { kind: 'previous7' };
  if (daysAgo <= 30) return { kind: 'previous30' };
  if (date.year === today.year) return { kind: 'month', year: date.year, month: date.month };
  return { kind: 'year', year: date.year };
}

export function groupKey(group: DateGroup): string {
  if (group.kind === 'month') return `month-${group.year}-${String(group.month).padStart(2, '0')}`;
  if (group.kind === 'year') return `year-${group.year}`;
  return group.kind;
}

/**
 * Splits notes into groups: pinned notes first (only if there are any), then
 * by the date the list is sorted by. Expects the order of `sortNotes` and
 * keeps it within each group; empty groups do not appear.
 */
export function groupNotes<T extends ListedNote>(
  sorted: readonly T[],
  sort: Exclude<NoteSort, 'title'>,
  now: number,
  timeZone?: string,
): Array<NoteGroup<T>> {
  const groups = new Map<string, NoteGroup<T>>();
  for (const note of sorted) {
    const group: DateGroup = note.pinned ? { kind: 'pinned' } : dateGroup(dateFor(note, sort), now, timeZone);
    const key = groupKey(group);
    let entry = groups.get(key);
    if (!entry) groups.set(key, (entry = { key, group, notes: [] }));
    entry.notes.push(note);
  }
  return [...groups.values()];
}

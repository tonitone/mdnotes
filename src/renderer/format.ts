import { getLocale, t } from '../shared/i18n';
import type { DateGroup } from '../shared/note-list';

/**
 * Date, time and number formats for the current UI language. Formatters are
 * created on first use, after the locale has been set, and keep the user's
 * region when it matches the UI language (en-GB stays en-GB).
 */

function formatTag(): string {
  const locale = getLocale();
  const regional = navigator.languages.find((tag) => tag.toLowerCase().split('-')[0] === locale);
  return regional ?? locale;
}

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat>(name: string, create: (tag: string) => T): T {
  const tag = formatTag();
  const key = `${tag}|${name}`;
  let formatter = cache.get(key) as T | undefined;
  if (!formatter) cache.set(key, (formatter = create(tag)));
  return formatter;
}

const time = () => cached('time', (tag) => new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }));
const date = () => cached('date', (tag) => new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }));
const dateTime = () => cached('dateTime', (tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }));
const oneDecimal = () => cached('oneDecimal', (tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
// Month and year groups name a calendar month or year, so they are formatted in UTC from a UTC date.
const monthName = () => cached('month', (tag) => new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }));
const yearName = () => cached('year', (tag) => new Intl.DateTimeFormat(tag, { year: 'numeric', timeZone: 'UTC' }));
const integer = () => cached('integer', (tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }));

export function formatTime(ms: number): string {
  return time().format(new Date(ms));
}

/** Time for today, otherwise the date. Used in lists. */
export function formatModified(ms: number): string {
  const value = new Date(ms);
  return value.toDateString() === new Date().toDateString() ? time().format(value) : date().format(value);
}

/** "Today, 14:05", "Yesterday, 09:10" or a full date and time. */
export function formatVersionTime(ms: number): string {
  const value = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (value.toDateString() === today.toDateString()) return t('time.today', { time: time().format(value) });
  if (value.toDateString() === yesterday.toDateString()) return t('time.yesterday', { time: time().format(value) });
  return dateTime().format(value);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${integer().format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${integer().format(bytes / 1024)} KB`;
  return `${oneDecimal().format(bytes / 1024 / 1024)} MB`;
}

/** Header of a date group in the note list: "Today", "October", "2025" in the UI language. */
export function groupTitle(group: DateGroup): string {
  switch (group.kind) {
    case 'pinned':
      return t('groups.pinned');
    case 'today':
      return t('groups.today');
    case 'yesterday':
      return t('groups.yesterday');
    case 'previous7':
      return t('groups.previous7');
    case 'previous30':
      return t('groups.previous30');
    case 'month':
      return monthName().format(Date.UTC(group.year, group.month - 1, 15));
    case 'year':
      return yearName().format(Date.UTC(group.year, 6, 1));
  }
}

/** Locale for comparing titles, the same one used for dates. */
export function collationLocale(): string {
  return formatTag();
}

/**
 * Shortens a file system path from the front so the last folders stay visible
 * ("/home/me/notes/work" becomes "…/notes/work"). Handles / and \ separators.
 */
export function shortenPath(path: string, max = 28): string {
  if (path.length <= max) return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  let tail = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = tail ? `${parts[i]}${separator}${tail}` : parts[i];
    if (next.length + 2 > max) break;
    tail = next;
  }
  // A single folder name longer than the limit is cut from the front.
  if (!tail) tail = (parts[parts.length - 1] ?? path).slice(-(max - 2));
  return `…${separator}${tail}`;
}

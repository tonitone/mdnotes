import { de } from './de';
import { en } from './en';

/**
 * Translations without dependencies, shared by main process, renderer and
 * tests. The current locale is module state: the main process sets it from
 * its config, the renderer once at start-up (a language change reloads the
 * window).
 */

export type MessageKey = keyof typeof de;
export type Messages = Record<MessageKey, string>;

/** Keys with plural forms, without the `.one` / `.other` suffix. */
export type PluralKey = { [K in MessageKey]: K extends `${infer Base}.one` ? Base : never }[MessageKey];

export const CATALOGS = { de, en } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof CATALOGS;
export const LOCALES = Object.keys(CATALOGS) as Locale[];

/** What the user picked; `system` follows the operating system. */
export type LanguageChoice = 'system' | Locale;
export const LANGUAGE_CHOICES: LanguageChoice[] = ['system', ...LOCALES];

/** Used when none of the preferred languages is available. */
export const FALLBACK_LOCALE: Locale = 'en';

let current: Locale = 'de';

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return typeof value === 'string' && (LANGUAGE_CHOICES as string[]).includes(value);
}

/** Primary language subtag, e.g. "pt" for "pt-BR". */
function primary(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0];
}

/** Picks the locale for a choice, using the OS or browser preference list for `system`. */
export function resolveLocale(choice: LanguageChoice, preferred: readonly string[]): Locale {
  if (choice !== 'system') return choice;
  for (const tag of preferred) {
    const lang = primary(tag) as Locale;
    if (LOCALES.includes(lang)) return lang;
  }
  return FALLBACK_LOCALE;
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Translates a key into the current locale and fills in {placeholders}. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return format(CATALOGS[current][key] ?? de[key], params);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** Like `t`, but picks the plural form for `count` (also available as {count}). */
export function tp(key: PluralKey, count: number, params?: Record<string, string | number>): string {
  let rules = pluralRules.get(current);
  if (!rules) pluralRules.set(current, (rules = new Intl.PluralRules(current)));
  const form = rules.select(count) === 'one' ? 'one' : 'other';
  return t(`${key}.${form}` as MessageKey, { count, ...params });
}

// ---------------------------------------------------------------------------
// Text direction. No right-to-left catalog exists yet, but layout and
// components already follow `dir`, so adding one needs no code changes.
// ---------------------------------------------------------------------------

const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi']);

export function isRtl(locale: string): boolean {
  return RTL_LANGUAGES.has(primary(locale));
}

export function textDirection(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

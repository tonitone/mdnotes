import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import { t } from '../shared/i18n';
import fioriLookUrl from './looks/fiori.css?url';
import macosLookUrl from './looks/macos.css?url';

/**
 * Appearance: SAP Horizon light, dark and two high-contrast variants.
 * "Follow system" evaluates the OS dark mode and forced colors (Windows
 * contrast themes).
 */

export type ThemeChoice = 'system' | 'light' | 'dark' | 'hcb' | 'hcw';
export type Density = 'compact' | 'cozy';
/** Optional style on top of Horizon, loaded only when chosen. */
export type Look = 'standard' | 'fiori' | 'macos';

export const LOOKS: Look[] = ['standard', 'fiori', 'macos'];
const LOOK_URLS: Record<Exclude<Look, 'standard'>, string> = { fiori: fioriLookUrl, macos: macosLookUrl };

const THEMES: Record<Exclude<ThemeChoice, 'system'>, string> = {
  light: 'sap_horizon',
  dark: 'sap_horizon_dark',
  hcb: 'sap_horizon_hcb',
  hcw: 'sap_horizon_hcw',
};

export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark', 'hcb', 'hcw'];

export function themeLabel(choice: ThemeChoice): string {
  return t(`theme.${choice}`);
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const contrastQuery = window.matchMedia('(forced-colors: active), (prefers-contrast: more)');

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // No storage available: the setting only lasts for this session.
  }
}

let themeChoice: ThemeChoice = read('mdnotes.theme', 'system', ['system', 'light', 'dark', 'hcb', 'hcw']);
let density: Density = read('mdnotes.density', 'compact', ['compact', 'cozy']);
let look: Look = read('mdnotes.look', 'standard', LOOKS);

function resolveTheme(choice: ThemeChoice): string {
  if (choice !== 'system') return THEMES[choice];
  if (contrastQuery.matches) return darkQuery.matches ? THEMES.hcb : THEMES.hcw;
  return darkQuery.matches ? THEMES.dark : THEMES.light;
}

function applyTheme(): void {
  const theme = resolveTheme(themeChoice);
  void setTheme(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme.includes('dark') || theme.endsWith('hcb') ? 'dark' : 'light';
  applyLook();
}

/**
 * Loads the look's style sheet. High-contrast themes always use the
 * standard look, so their tested contrast is never changed.
 */
function applyLook(): void {
  const highContrast = /hc[bw]$/.test(document.documentElement.dataset.theme ?? '');
  const effective: Look = highContrast ? 'standard' : look;
  document.documentElement.dataset.look = effective;
  let link = document.getElementById('look-style') as HTMLLinkElement | null;
  if (effective === 'standard') {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.id = 'look-style';
    link.rel = 'stylesheet';
    document.head.append(link);
  }
  link.href = LOOK_URLS[effective];
}

function applyDensity(): void {
  const compact = density === 'compact';
  document.body.classList.toggle('ui5-content-density-compact', compact);
  document.body.toggleAttribute('data-ui5-compact-size', compact);
}

export function initAppearance(): void {
  applyTheme();
  applyDensity();
  darkQuery.addEventListener('change', applyTheme);
  contrastQuery.addEventListener('change', applyTheme);
}

export function getThemeChoice(): ThemeChoice {
  return themeChoice;
}

export function setThemeChoice(choice: ThemeChoice): void {
  themeChoice = choice;
  write('mdnotes.theme', choice);
  applyTheme();
}

export function getLook(): Look {
  return look;
}

export function setLook(value: Look): void {
  look = value;
  write('mdnotes.look', value);
  applyLook();
}

export function getDensity(): Density {
  return density;
}

export function setDensity(value: Density): void {
  density = value;
  write('mdnotes.density', value);
  applyDensity();
}

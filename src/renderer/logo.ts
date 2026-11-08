import logoDark from './assets/logo-dark.svg';
import logoHcb from './assets/logo-hcb.svg';
import logoHcw from './assets/logo-hcw.svg';
import logoLight from './assets/logo-light.svg';

/**
 * The mdnotes mark in the shell bar. The shell bar hides its primary title in
 * narrow windows but keeps the logo, so the mark carries the app name there.
 *
 * An <img> cannot use currentColor, so every theme gets its own file: a
 * colored tile for light and dark, a one-color outline for the high contrast
 * themes. The image itself is decorative (alt=""); the shell bar names the
 * logo area through accessibilityAttributes.logo.name.
 */
const LOGOS: Record<string, string> = {
  sap_horizon: logoLight,
  sap_horizon_dark: logoDark,
  sap_horizon_hcb: logoHcb,
  sap_horizon_hcw: logoHcw,
};

export function updateShellLogo(theme: string): void {
  const logo = document.getElementById('shellLogo') as HTMLImageElement | null;
  const src = LOGOS[theme] ?? logoLight;
  // Compare against the attribute: the property is resolved to an absolute URL.
  if (logo && logo.getAttribute('src') !== src) logo.src = src;
}

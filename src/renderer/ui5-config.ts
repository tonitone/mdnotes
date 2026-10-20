/**
 * Must be loaded as the very first module, before UI5 starts.
 * Otherwise UI5 loads the "72" font from the SAP CDN. The app works offline,
 * so the fonts are served locally (see scripts/copy-fonts.mjs).
 */
import { setDefaultFontLoading } from '@ui5/webcomponents-base/dist/config/Fonts.js';
import './generated/fonts.css';

setDefaultFontLoading(false);

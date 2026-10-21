// Must come first: fonts are served locally instead of from the SAP CDN.
import './ui5-config';

// Bundle themes, translations and locale data.
import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
// F6 and Shift+F6 jump between areas (data-sap-ui-fastnavgroup).
import '@ui5/webcomponents-base/dist/features/F6Navigation.js';

import '@ui5/webcomponents/dist/Button.js';
import '@ui5/webcomponents/dist/CheckBox.js';
import '@ui5/webcomponents/dist/Option.js';
import '@ui5/webcomponents/dist/Select.js';
import '@ui5/webcomponents/dist/Dialog.js';
import '@ui5/webcomponents/dist/Label.js';
import '@ui5/webcomponents/dist/MultiInput.js';
import '@ui5/webcomponents/dist/SuggestionItem.js';
import '@ui5/webcomponents/dist/Toast.js';
import '@ui5/webcomponents/dist/Token.js';
import '@ui5/webcomponents/dist/features/InputSuggestions.js';
import '@ui5/webcomponents/dist/Icon.js';
import '@ui5/webcomponents/dist/Input.js';
import '@ui5/webcomponents/dist/List.js';
import '@ui5/webcomponents/dist/ListItemStandard.js';
import '@ui5/webcomponents/dist/Menu.js';
import '@ui5/webcomponents/dist/MenuItem.js';
import '@ui5/webcomponents/dist/MenuSeparator.js';
import '@ui5/webcomponents/dist/MessageStrip.js';
import '@ui5/webcomponents/dist/Title.js';
import '@ui5/webcomponents-fiori/dist/FlexibleColumnLayout.js';
import '@ui5/webcomponents-fiori/dist/IllustratedMessage.js';
import '@ui5/webcomponents-fiori/dist/ShellBar.js';
import '@ui5/webcomponents-fiori/dist/ShellBarItem.js';
import '@ui5/webcomponents-fiori/dist/illustrations/NoData.js';
import '@ui5/webcomponents-fiori/dist/illustrations/NoEntries.js';

import '@ui5/webcomponents-icons/dist/accept.js';
import '@ui5/webcomponents-icons/dist/edit.js';
import '@ui5/webcomponents-icons/dist/history.js';
import '@ui5/webcomponents-icons/dist/save.js';
import '@ui5/webcomponents-icons/dist/shield.js';
import '@ui5/webcomponents-icons/dist/action.js';
import '@ui5/webcomponents-icons/dist/copy.js';
import '@ui5/webcomponents-icons/dist/delete.js';
import '@ui5/webcomponents-icons/dist/download.js';
import '@ui5/webcomponents-icons/dist/overflow.js';
import '@ui5/webcomponents-icons/dist/pdf-attachment.js';
import '@ui5/webcomponents-icons/dist/tag.js';
import '@ui5/webcomponents-icons/dist/undo.js';
import '@ui5/webcomponents-icons/dist/upload.js';
import '@ui5/webcomponents-icons/dist/add.js';
import '@ui5/webcomponents-icons/dist/document-text.js';
import '@ui5/webcomponents-icons/dist/documents.js';
import '@ui5/webcomponents-icons/dist/nav-back.js';
import '@ui5/webcomponents-icons/dist/open-folder.js';
import '@ui5/webcomponents-icons/dist/globe.js';
import '@ui5/webcomponents-icons/dist/palette.js';
import '@ui5/webcomponents-icons/dist/search.js';

import './styles.css';
import { t } from '../shared/i18n';
import { getApi } from './api';
import { App } from './app';
import { applyLocale } from './i18n';
import { initAppearance } from './theme';

async function start(): Promise<void> {
  const api = await getApi();
  // The language must be in place before the app renders any text.
  const { choice, locale } = await api.getLanguage();
  await applyLocale(locale);
  // Only then the theme: switching both at once makes UI5 re-render
  // components whose translations are still loading (seen with dark themes
  // in the production build).
  initAppearance();
  await new App(api, choice).start();
}

start().catch((err: unknown) => {
  const region = document.getElementById('errorRegion');
  if (region) region.textContent = t('app.startFailed', { error: String(err) });
  console.error(err);
});

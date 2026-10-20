// Must come first: fonts are served locally instead of from the SAP CDN.
import './ui5-config';

// Bundle themes, translations and locale data.
import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
// F6 and Shift+F6 jump between areas (data-sap-ui-fastnavgroup).
import '@ui5/webcomponents-base/dist/features/F6Navigation.js';

import '@ui5/webcomponents/dist/Button.js';
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
import '@ui5/webcomponents-icons/dist/add.js';
import '@ui5/webcomponents-icons/dist/document-text.js';
import '@ui5/webcomponents-icons/dist/documents.js';
import '@ui5/webcomponents-icons/dist/nav-back.js';
import '@ui5/webcomponents-icons/dist/open-folder.js';
import '@ui5/webcomponents-icons/dist/palette.js';
import '@ui5/webcomponents-icons/dist/search.js';

import './styles.css';
import { getApi } from './api';
import { App } from './app';
import { initAppearance } from './theme';

initAppearance();

getApi()
  .then((api) => new App(api).start())
  .catch((err: unknown) => {
    const region = document.getElementById('errorRegion');
    if (region) region.textContent = `Die App konnte nicht starten: ${String(err)}`;
    console.error(err);
  });

# mdnotes

**Local Markdown notes, built with SAP ui5-webcomponents**

Themed with **SAP Horizon** (light, dark, high contrast), in the style of Apple Notes.
macOS, Windows and Linux. Notes are plain `.md` files in a folder you choose.

## Features

- **Write:** live preview, formatting toolbar, images, code blocks, tables, outline, word count
- **Organize:** labels, pin and sort, date groups, trash with undo
- **Find:** full-text search with snippets
- **Protect:** versions, backups, crash recovery, detection of outside changes
- **Share:** export to Markdown, Jira/Confluence wiki markup and PDF, import of `.md` files
- **Look:** SAP Horizon themes, cozy or compact, German and English, right-to-left ready

## Quick start

Needs Node.js 22 or 24 (LTS).

```bash
npm install          # also copies the font "72"
npm run dev:browser  # UI in the browser with demo notes: http://127.0.0.1:5173
npm run dev          # real app with Electron
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron app from source |
| `npm run dev:browser` | UI only, mock adapter instead of the file system |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit`, `npm run test:e2e` | Unit tests, UI and accessibility tests |
| `npm run package` | Installer for the current system (`release/`) |

## Accessibility

- F6 and Shift+F6 jump between library, list and editor
- Esc, then Tab leaves the editor
- Two high-contrast themes, WCAG 2.2 AA

## More

- [Features](docs/features.md), [Architecture](docs/architecture.md), [Notes format](docs/notes-format.md)
- [Languages](docs/i18n.md), [Security](docs/security.md), [Accessibility](docs/accessibility.md)
- [Roadmap](docs/roadmap.md)

## Known issues

- **UI5** is pinned to 2.27.2: the tokenizer render loop with very many labels is fixed in 2.28.0
- **Font 72:** `scripts/copy-fonts.mjs` falls back to Arial or Helvetica if it finds no files
- **Backups** are not encrypted, in a cloud folder the notes are plain text
- **Wiki export:** tasks become ☐/☑, images need a separate upload; **PDF export** only in the app

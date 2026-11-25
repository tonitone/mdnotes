# Project context for Claude

Local Markdown editor in the style of Apple Notes, designed after SAP Fiori. Status: phase 4 complete.

## Fixed decisions

- Electron (not Tauri), TypeScript, electron-vite, Node.js 22/24 LTS.
- UI5 Web Components exactly 2.27.2, SAP Horizon themes (light, dark, hcb, hcw). No corporate theme.
- CodeMirror 6 with a custom Live Preview (`src/renderer/editor/live-preview.ts`). No WYSIWYG.
- Plain `.md` files in a selectable workspace, including subfolders (flat list, no folder tree),
  everything local: no network, no account, no telemetry. Internally, a note's file name is its path
  relative to the workspace with `/` (`src/shared/workspace-path.ts`).
- Platforms: macOS, Windows, Linux. Linux is a first-class target.
- A note's identity = ULID in the front matter. The file name `title-slug--<last 6 characters of the ID>.md` follows the title.
- Title = first line. The front matter contains only `id`, `labels`, `created` and `pinned` (only as `pinned: true`,
  omitted otherwise); foreign lines stay unchanged. The list's sort order is an app setting (`config.json`).
- Browser mode (`npm run dev:browser`) with a mock adapter, for development and tests only, never shipped.
- Accessibility: WCAG 2.2 AA, EN 301 549. F6 moves between areas, Esc then Tab leaves the editor.

## Architecture rules

- `src/shared/` has no dependencies and runs in main, renderer and tests.
- The UI talks to the file system only through `NotesApi` (`src/shared/api.ts`).
- Electron and browser mode use the same `NoteStore` logic; only the `FsPort` underneath differs.
- File access only in the main process. Every IPC argument is validated there.
- Never overwrite an existing file: `create` with `wx`, writes are atomic via a temporary file.

## Status and next steps

- Phases 1 to 4 are done. CI checks types, unit tests (`tests/unit`), UI and
  accessibility tests in browser mode (`tests/e2e`) and a smoke test of the real
  Electron app on macOS, Windows and Linux (`tests/electron`).
- New npm packages only together with an updated `package-lock.json` (CI uses `npm ci`).
- UI in German and English: new texts always go into `src/shared/i18n/de.ts` and `en.ts`,
  never hard-coded. Static HTML texts via `data-i18n`/`data-i18n-attr`. Tests run in German.
- Versions: `.history/<id>/<ms>-<hash8>.md`, snapshot in `finalize()`, before `restoreVersion()`
  and before a change from outside is taken over.
- Backups: `src/main/backup.ts` (ZIP + manifest), settings in `config.json` in the app profile.
  Emergency files for crash recovery live in the app profile under `recovery/`, never in the workspace.
- Phase 4 is done: i18n/RTL, accessibility audit (`docs/accessibility.md`), HTML/DOCX export,
  strict CSP. Code signing and auto-update are dropped (no app store).
- UI tests (`tests/e2e`) run against the production build (`E2E_DEV=1` for the dev server)
  and import `test`/`expect` from `tests/e2e/fixtures.ts` (checks for CSP violations).
- Open: encrypt backups (optional, #31), block-wise restore from a version (#32).
- Next: All open packages (phase 5 and design revision D1 to D7) are GitHub issues in the milestones
  "Phase 5.1" to "Phase 5.4" and "Später" (later). The order is in `docs/roadmap.md`; Toni decides it.
  One PR per issue, the description contains `Closes #n`. Background: claude.ai Artifacts "Plan: Markdown-Editor"
  (phase 5 backlog) and "Plan: Design-Überarbeitung mdnotes".

## Way of working

- Rules for agent contributions (commit trailers, PR roles, models, no promotional footers): @AGENTS.md
- Language: everything written into the repository is English: code, comments, commits, docs, rules,
  CLAUDE.md, AGENTS.md, issues, PRs, reviews and prompts of scheduled tasks. Conversation with Toni is in German,
  short and concrete. The only German in the repo is the German UI catalog and the German tests that use it.
- One PR per topic, report only once CI is green. Bugs before features.
  For larger, ambiguous tasks, ask briefly first.
- Design: standard Horizon. Custom looks were rejected (PR #9). Never modify UI5 components.
- Do not restyle UI5 components from outside either: no `display`, `width`, `flex` or `padding` on the host.
  Author CSS beats `:host` rules and breaks the inner layout (example: `display: block` on `ui5-toolbar`
  made every button measure at full width, so everything ended up in the overflow).
- If a UI5 component seems not to work, check our own side first (CSS on the host, missing imports,
  wrong children in the slot, hidden container at first render, test assumptions). Replace or drop it only with
  a proven cause in the UI5 source of the pinned version (file and line) in the PR description.
- Controls (button, select, checkbox, input, menu, dialog, list) are always UI5 components.
  Content (Markdown in editor and preview) stays semantic HTML and CodeMirror. The code tools
  (`ui5-select`, `ui5-button`) in `live-preview.ts` are UI5. The task checkbox stays the native
  `<input type="checkbox">`, as part of the Markdown content (spike D7 with `ui5-checkbox` failed):
  it would have to be shrunk below its intended box of 2.75rem/2rem (modifies UI5, click area
  and focus ring stick out of the line, a height below 24 px endangers WCAG 2.5.8), and every keystroke over
  a task would re-create heavy shadow DOM elements. Checks on the native checkbox:
  keyboard (Space), target size at least 24 px via CSS, accessible name (`task.open`/`task.done`).
- Every new view and every new dialog gets an axe test in `tests/e2e/a11y.spec.ts`.
- Cloud session: the npm registry is reachable (`npm ci`, new packages with `npm install`, commit the lockfile).
  Types, unit, UI and Electron tests also run locally; Playwright there with the pre-installed Chromium
  (`launchOptions.executablePath`), Electron under `xvfb-run`. CI remains the authoritative test loop;
  read failures via the check-run annotations API. PRs via the REST API.

## Known risks

- CodeMirror needs `root: document` (focus inside the UI5 slot). Multi-line replacements only via a `StateField`.
- Set the UI5 theme only after the language, otherwise the app stays blank with the dark theme.
- FCL does not fire `layout-change` for programmatic layouts: always use `setLayout()`.
  `setLayout()` keeps the library closed (`ThreeColumnsStartHiddenEndExpanded`) as long as the user has collapsed it
  in the wide window (`libraryCollapsed`, session only).
- UI5 list items contain invisible extra text: in tests use `toContainText` instead of `toHaveText`.
- UI5 2.27.2 has a render loop bug in `ui5-tokenizer` (fixed from 2.28.0). Affects the label field with very many labels.
- The 72 font is copied from node_modules by `scripts/copy-fonts.mjs`. Check the paths if the console warns.
- CSP without `unsafe-inline`: new code must not set `style` attributes or `<style>` elements,
  only classes or `element.style` (CSSOM). CodeMirror gets the nonce via `cspNonce()`.

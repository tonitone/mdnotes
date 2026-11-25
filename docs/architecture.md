# Architecture

## Source layout

Not every file is listed.

```
src/
  shared/         Core logic without dependencies, runs everywhere
    note.ts         ULID, file name, title, front matter
    note-store.ts   Save, rename, labels, search, trash, import, change detection
    history.ts      Versions in .history/<id>/ with retention rules
    fs-port.ts      File system interface + MemoryFs
    workspace-path.ts Relative note paths: validation, skipped folders, depth limit
    assets.ts       Images and attachments in assets/ (name from the content hash)
    markdown/       Parser and export to wiki markup and HTML
    api.ts          Interface between the UI and the file system
    i18n/           Language files (de.ts defines the keys, en.ts must have all of them)
  main/           Electron main process: window, menu, IPC, security
    workspace.ts    Workspace with file watcher (recursive; on Linux one watcher per scanned folder)
    transfer.ts     Export (Markdown, wiki, PDF) and import
    node-fs.ts      File system access, limited to the workspace (recursive scan, symbolic links)
    backup.ts       Backups with manifest, verify, restore
    zip.ts          Read and write ZIP (no dependencies, with Zip Slip protection)
    recovery.ts     Emergency files for unsaved text (in the app profile)
  preload/        Exposes the interface as window.notesApi
  renderer/       UI: UI5 Web Components, CodeMirror with live preview
    adapters/       Mock adapter for the browser mode
tests/
  unit/           node:test, run against MemoryFs and the real file system
  e2e/            Playwright in browser mode
  electron/       Smoke test of the built app, in CI on all three systems
```

## One store logic for both modes

The browser mode and Electron use the same `NoteStore` logic. Only the file system
underneath differs (`MemoryFs` or `NodeFs`), so the two variants cannot drift apart.
In the Electron build `__BROWSER_MODE__` is `false`, so the mock adapter is not shipped.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron app from source, UI changes show up at once |
| `npm run dev:browser` | UI only in the browser, with the mock adapter instead of the file system |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit` | Core logic against memory and the real file system |
| `npm run test:e2e` | UI and accessibility tests in browser mode (Playwright, axe) |
| `npm run test:electron` | Smoke test of the real app (run `npm run build` first) |
| `npm run package` | Installer for the current system (`release/`) |
| `node scripts/generate-icons.mjs` | Rebuilds `build/icon.icns`, `build/icon.ico` and `build/icons/*.png` from `build/icon/mdnotes-icon.svg` |

Run `npx playwright install chromium` once before the first e2e run.

The app icon lives in `build/icon/mdnotes-icon.svg` (1024 px master, PNG next to it). After editing the SVG, run
`node scripts/generate-icons.mjs` and commit the generated files; electron-builder reads them from `build/`.
The default icon is SAP blue (`#0070F2`). Earlier designs are archived in `build/icon/variants/<name>/`
(currently `light-blue`); the build ignores them. To switch back, copy a variant's SVG over
`build/icon/mdnotes-icon.svg` and run the generator.

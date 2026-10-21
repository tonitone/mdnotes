# Projektkontext für Claude

Lokaler Markdown-Editor im Stil von Apple Notes, gestaltet nach SAP Fiori. Stand: Phase 3 abgeschlossen.

## Feste Entscheidungen

- Electron (nicht Tauri), TypeScript, electron-vite, Node.js 22/24 LTS.
- UI5 Web Components exakt 2.27.2, Themes SAP Horizon (hell, dunkel, hcb, hcw). Kein Corporate-Theme.
- CodeMirror 6 mit selbst gebauter Live Preview (`src/renderer/editor/live-preview.ts`). Kein WYSIWYG.
- Plain `.md`-Dateien in einem wählbaren Workspace, alles lokal: kein Netzwerk, kein Account, keine Telemetrie.
- Plattformen: macOS, Windows, Linux. Linux ist ein vollwertiges Ziel.
- Identität einer Notiz = ULID im Front Matter. Dateiname `titel-slug--<letzte 6 Zeichen der ID>.md` folgt dem Titel.
- Titel = erste Zeile. Front Matter enthält nur `id`, `labels`, `created`, fremde Zeilen bleiben unverändert.
- Browser-Modus (`npm run dev:browser`) mit Mock-Adapter nur für Entwicklung und Tests, nie ausgeliefert.
- Barrierefreiheit: WCAG 2.2 AA, EN 301 549. F6 zwischen Bereichen, Esc dann Tab verlässt den Editor.

## Architekturregeln

- `src/shared/` hat keine Abhängigkeiten und läuft in Main, Renderer und Tests.
- Die Oberfläche spricht nur über `NotesApi` (`src/shared/api.ts`) mit dem Dateisystem.
- Electron und Browser-Modus nutzen dieselbe `NoteStore`-Logik, nur das `FsPort` darunter unterscheidet sich.
- Dateizugriff nur im Main-Prozess. Jedes IPC-Argument wird dort geprüft.
- Nie eine bestehende Datei überschreiben: `create` mit `wx`, Schreiben atomar über temporäre Datei.

## Stand und nächste Schritte

- Phase 1, 2 und 3 sind fertig. CI prüft Typen, Unit-Tests (`tests/unit`), UI- und
  Barrierefreiheitstests im Browser-Modus (`tests/e2e`) und einen Smoke-Test der echten
  Electron-App auf macOS, Windows und Linux (`tests/electron`).
- Neue npm-Pakete nur zusammen mit aktualisierter `package-lock.json` (CI nutzt `npm ci`).
- Commits auf Englisch nach Conventional Commits, Code-Kommentare auf Englisch,
  Oberfläche vorerst Deutsch.
- Versionen: `.history/<id>/<ms>-<hash8>.md`, Snapshot in `finalize()`, vor `restoreVersion()`
  und bevor eine Änderung von außen übernommen wird.
- Backups: `src/main/backup.ts` (ZIP + Manifest), Einstellungen in `config.json` im App-Profil.
  Notfalldateien für Crash-Recovery liegen im App-Profil unter `recovery/`, nie im Workspace.
- Phase 4: Barrierefreiheits-Audit, i18n/RTL, HTML/DOCX-Export, Signierung, Auto-Update, CSP verschärfen.
- Offen: Backups verschlüsseln (optional), blockweises Wiederherstellen aus einer Version.

## Bekannte Risiken

- UI5 2.27.2 hat einen Render-Loop-Fehler im `ui5-tokenizer` (behoben ab 2.28.0). Betrifft das Label-Feld bei sehr vielen Labels.
- Die Schrift 72 kopiert `scripts/copy-fonts.mjs` aus node_modules. Pfade prüfen, falls die Konsole warnt.
- CSP erlaubt vorerst Inline-Styles.

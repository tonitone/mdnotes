# Projektkontext für Claude

Lokaler Markdown-Editor im Stil von Apple Notes, gestaltet nach SAP Fiori. Stand: MVP-Gerüst (Phase 1).

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

- Unit-Tests (`npm run test:unit`, 55 Tests) liefen grün.
- Die Oberfläche wurde noch nie gestartet, weil beim Erstellen kein npm-Zugriff bestand.
  Erster Schritt: `npm install`, `npm run typecheck`, `npm run dev:browser`, `npm run test:e2e`
  und Fehler beheben. Zu erwarten sind kleine API-Abweichungen bei UI5 oder CodeMirror.
- Danach Phase 2: Labels, Bilder per Paste, Code-Blöcke, Suche, Papierkorb, Content Density,
  Import/Export `.md`, Export als PDF und Jira/Confluence-Wiki-Markup (klassisches Jira-Wiki-Format).
- Phase 3: Versionierung (Snapshots pro ID unter `.history/<id>/`, Diff, Wiederherstellen),
  Backup/Restore inkl. einzelner Notizen, Crash-Recovery.
- Phase 4: Barrierefreiheits-Audit, i18n/RTL, HTML/DOCX-Export, Signierung, Auto-Update, CSP verschärfen.

## Bekannte Risiken

- UI5 2.27.2 hat einen Render-Loop-Fehler im `ui5-tokenizer` (behoben ab 2.28.0). Relevant für Labels.
- Die Schrift 72 kopiert `scripts/copy-fonts.mjs` aus node_modules. Pfade prüfen, falls die Konsole warnt.
- CSP erlaubt vorerst Inline-Styles.

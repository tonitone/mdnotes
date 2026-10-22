# Projektkontext für Claude

Lokaler Markdown-Editor im Stil von Apple Notes, gestaltet nach SAP Fiori. Stand: Phase 4 abgeschlossen.

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

- Phase 1 bis 4 sind fertig. CI prüft Typen, Unit-Tests (`tests/unit`), UI- und
  Barrierefreiheitstests im Browser-Modus (`tests/e2e`) und einen Smoke-Test der echten
  Electron-App auf macOS, Windows und Linux (`tests/electron`).
- Neue npm-Pakete nur zusammen mit aktualisierter `package-lock.json` (CI nutzt `npm ci`).
- Commits auf Englisch nach Conventional Commits, Code-Kommentare auf Englisch.
- Oberfläche Deutsch und Englisch: neue Texte immer in `src/shared/i18n/de.ts` und `en.ts`,
  nie fest im Code. Statische HTML-Texte über `data-i18n`/`data-i18n-attr`. Tests laufen auf Deutsch.
- Versionen: `.history/<id>/<ms>-<hash8>.md`, Snapshot in `finalize()`, vor `restoreVersion()`
  und bevor eine Änderung von außen übernommen wird.
- Backups: `src/main/backup.ts` (ZIP + Manifest), Einstellungen in `config.json` im App-Profil.
  Notfalldateien für Crash-Recovery liegen im App-Profil unter `recovery/`, nie im Workspace.
- Phase 4 ist fertig: i18n/RTL, Barrierefreiheits-Audit (`docs/accessibility.md`), HTML/DOCX-Export,
  strenge CSP. Signierung und Auto-Update entfallen (kein App-Store).
- UI-Tests (`tests/e2e`) laufen gegen den Produktions-Build (`E2E_DEV=1` für den Dev-Server)
  und importieren `test`/`expect` aus `tests/e2e/fixtures.ts` (prüft CSP-Verstöße).
- Offen: Backups verschlüsseln (optional), blockweises Wiederherstellen aus einer Version.
- Nächstes: Phase 5 „Alltag und Komfort“. Backlog 1–12 und Übergabe stehen im Plan-Dokument
  (claude.ai Artifact „Plan: Markdown-Editor“, Abschnitt „Backlog Phase 5“). Erstes Paket, je ein PR:
  1. Formatier-Kürzel (Cmd+B/I/K, Cmd+Shift+X) und Toolbar, 2. Anheften und Sortieren
  (Entscheidung offen: `pinned` im Front Matter oder in `config.json`), 3. „Rückgängig“ nach dem Löschen,
  4. Tastenkürzel-Übersicht (Cmd+/).
  Danach: 5. `[[Links]]` mit Rückverweisen, 6. Gliederung, 7. Tabellen bearbeiten, 8. Wörter zählen,
  9. Duplizieren und Vorlagen. Später: 10. Mathe, Mermaid, Fußnoten, 11. Anhänge, 12. Tabs oder Fenster.
- Design-Überarbeitung: claude.ai Artifact „Plan: Design-Überarbeitung mdnotes“ (Pakete D1 bis D7, je ein PR).
  Vorgeschlagene Reihenfolge, Toni entscheidet pro Sitzung: D1 Split-Ansicht nach Spaltenbreite, D3 Sprachauswahl aus „Darstellung“ in ein eigenes
  Shellbar-Menü, D7 UI5 im Editor. Dann Phase 5 Paket 1 zusammen mit D2 (Editor-Kopfzeile) und Punkt 2
  zusammen mit D4 (Datumsgruppen in der Notizliste). D5 und D6 zwischen den Features.

## Arbeitsweise

- Gesprächssprache Deutsch, kurz und konkret. Pro Thema ein PR, erst bei grüner CI melden. Bugs vor Features.
  Bei größeren, mehrdeutigen Aufgaben vorher kurz fragen.
- Design: Standard-Horizon. Eigene Looks wurden abgelehnt (PR #9). UI5-Komponenten nie verändern.
- Bedienelemente (Knopf, Auswahl, Checkbox, Eingabe, Menü, Dialog, Liste) sind immer UI5-Komponenten.
  Inhalt (Markdown in Editor und Vorschau) bleibt semantisches HTML und CodeMirror. Noch nativ: die
  Code-Werkzeuge und das Aufgaben-Kästchen in `live-preview.ts` (Umstellung ist Paket D7 im Design-Plan).
- Jede neue Ansicht und jeder neue Dialog bekommt einen axe-Test in `tests/e2e/a11y.spec.ts`.
- Cloud-Sitzung: npm-Registry gesperrt (neue Pakete nur mit Lockfile vom Mac des Nutzers), lokal nur
  Unit-Tests. Die CI ist die Testschleife; Fehler über die Check-Run-Annotations-API lesen. PRs über die REST-API.

## Bekannte Risiken

- CodeMirror braucht `root: document` (Fokus im UI5-Slot). Mehrzeilige Ersetzungen nur über ein `StateField`.
- UI5-Theme erst nach der Sprache setzen, sonst bleibt die App mit dunklem Theme leer.
- FCL feuert `layout-change` nicht bei programmatischem Layout: immer `setLayout()` nutzen.
- UI5-Listeneinträge enthalten unsichtbaren Zusatztext: in Tests `toContainText` statt `toHaveText`.
- UI5 2.27.2 hat einen Render-Loop-Fehler im `ui5-tokenizer` (behoben ab 2.28.0). Betrifft das Label-Feld bei sehr vielen Labels.
- Die Schrift 72 kopiert `scripts/copy-fonts.mjs` aus node_modules. Pfade prüfen, falls die Konsole warnt.
- CSP ohne `unsafe-inline`: Neuer Code darf keine `style`-Attribute oder `<style>`-Elemente
  setzen, nur Klassen oder `element.style` (CSSOM). CodeMirror bekommt die Nonce über `cspNonce()`.

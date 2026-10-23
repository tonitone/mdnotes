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
- Offen: Backups verschlüsseln (optional, #31), blockweises Wiederherstellen aus einer Version (#32).
- Nächstes: Alle offenen Pakete (Phase 5 und Design-Überarbeitung D1 bis D7) sind GitHub-Issues in den Meilensteinen
  „Phase 5.1“ bis „Phase 5.4“ und „Später“. Die Reihenfolge steht in `docs/roadmap.md`, Toni entscheidet sie.
  Ein PR pro Issue, die Beschreibung enthält `Closes #n`. Hintergrund: claude.ai Artifacts „Plan: Markdown-Editor“
  (Backlog Phase 5) und „Plan: Design-Überarbeitung mdnotes“.

## Arbeitsweise

- Gesprächssprache Deutsch, kurz und konkret. Pro Thema ein PR, erst bei grüner CI melden. Bugs vor Features.
  Bei größeren, mehrdeutigen Aufgaben vorher kurz fragen.
- Design: Standard-Horizon. Eigene Looks wurden abgelehnt (PR #9). UI5-Komponenten nie verändern.
- Bedienelemente (Knopf, Auswahl, Checkbox, Eingabe, Menü, Dialog, Liste) sind immer UI5-Komponenten.
  Inhalt (Markdown in Editor und Vorschau) bleibt semantisches HTML und CodeMirror. Die Code-Werkzeuge
  (`ui5-select`, `ui5-button`) in `live-preview.ts` sind UI5. Das Aufgaben-Kästchen bleibt das native
  `<input type="checkbox">`, als Teil des Markdown-Inhalts (Spike D7 mit `ui5-checkbox` ist gescheitert):
  Es müsste unter die vorgesehene Box von 2,75rem/2rem verkleinert werden (UI5 verändert, Klickfläche
  und Fokusring ragen aus der Zeile, Höhe unter 24 px gefährdet WCAG 2.5.8), und jeder Tastendruck über
  einer Aufgabe würde schwere Shadow-DOM-Elemente neu erzeugen. Prüfungen am nativen Kästchen:
  Tastatur (Space), Zielgröße mindestens 24 px per CSS, zugänglicher Name (`task.open`/`task.done`).
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

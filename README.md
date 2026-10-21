# mdnotes

Lokaler Markdown-Editor im Stil von Apple Notes, gestaltet nach SAP Fiori (Horizon).
Läuft auf macOS, Windows und Linux. Notizen sind normale `.md`-Dateien in einem Ordner deiner Wahl.

Stand: Phase 3 des Plans abgeschlossen.

## Funktionen

- Notizen anlegen, Titel aus der ersten Zeile, Autosave, Dateiname folgt dem Titel
- Live Preview: Überschriften, Hervorhebungen, Links, Listen, Aufgaben, Zitate, Bilder
- Labels mit Vorschlägen, Filter nach Label in der Bibliothek
- Bilder per Einfügen oder Ziehen, gespeichert in `assets/`, mit Abfrage einer Bildbeschreibung
- Code-Blöcke mit Syntax-Highlighting, Sprachauswahl und Kopieren-Knopf
- Volltextsuche über Titel und Inhalt, Treffer mit Textausschnitt
- Papierkorb (`.trash/`, 30 Tage), Wiederherstellen und endgültiges Löschen
- Export einer Notiz als Markdown (mit Bildern), Jira/Confluence-Wiki-Markup oder PDF,
  Wiki-Markup und Markdown auch direkt in die Zwischenablage
- Export aller Notizen in einen neuen Ordner, Import von Markdown-Dateien (per Menü mit
  Bildübernahme oder per Ziehen ins Fenster)
- Änderungen von außen (anderer Editor, Sync-Tool) werden erkannt; bei gleichzeitiger
  Bearbeitung fragt die App, welche Version gilt
- Themes Hell, Dunkel und zwei Hochkontrast-Varianten, Dichte Kompakt oder Komfortabel
- Versionen: automatisch nach einer Bearbeitungspause, Vergleich alt gegen aktuell,
  Wiederherstellen ohne Datenverlust (Aufbewahrung: 24 Stunden alles, dann täglich
  für 30 Tage, dann wöchentlich)
- Backups als ZIP mit SHA-256-Prüfsummen in einem eigenen Ordner, manuell, beim Beenden
  oder täglich; Sicherheitskopie vor Import und endgültigem Löschen; einzelne Notizen
  oder ein ganzes Backup wiederherstellen
- Crash-Recovery: ungespeicherter Text wird nach einem Absturz beim Start angeboten
- Labels über alle Notizen umbenennen oder zusammenführen
- Oberfläche auf Deutsch oder Englisch (folgt dem System oder fest eingestellt unter
  Darstellung → Sprache), Layout für Rechts-nach-links-Sprachen vorbereitet

## Schnellstart

Voraussetzung: Node.js 22 oder 24 (LTS).

```bash
npm install            # kopiert danach automatisch die Schrift "72" (scripts/copy-fonts.mjs)
npm run dev:browser    # Oberfläche im Browser mit Demo-Notizen: http://127.0.0.1:5173
npm run dev            # echte App mit Electron, Hot Reload, ohne Installer-Build
```

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Electron-App aus dem Quellcode, Änderungen an der Oberfläche sofort sichtbar |
| `npm run dev:browser` | Nur die Oberfläche im Browser, mit Mock-Adapter statt Dateisystem |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run test:unit` | Kernlogik gegen Speicher und echtes Dateisystem |
| `npm run test:e2e` | UI- und Barrierefreiheitstests im Browser-Modus (Playwright, axe) |
| `npm run test:electron` | Smoke-Test der echten App (vorher `npm run build`) |
| `npm run package` | Installer für das aktuelle System (`release/`) |

Beim ersten E2E-Lauf einmal `npx playwright install chromium` ausführen.

## Aufbau

```
src/
  shared/         Kernlogik ohne Abhängigkeiten, läuft überall
    note.ts         ULID, Dateiname, Titel, Front Matter
    note-store.ts   Speichern, Umbenennen, Labels, Suche, Papierkorb, Import, Änderungserkennung
    history.ts      Versionen in .history/<id>/ mit Aufbewahrungsregeln
    fs-port.ts      Dateisystem-Schnittstelle + MemoryFs
    assets.ts       Bilder in assets/ (Name aus dem Inhalts-Hash)
    markdown/       Parser und Export nach Wiki-Markup und HTML
    api.ts          Schnittstelle zwischen Oberfläche und Dateisystem
    i18n/           Sprachdateien (de.ts legt die Schlüssel fest, en.ts muss sie alle haben)
  main/           Electron-Hauptprozess: Fenster, Menü, IPC, Sicherheit
    workspace.ts    Workspace mit File-Watcher
    transfer.ts     Export (Markdown, Wiki, PDF) und Import
    node-fs.ts      Dateisystem-Zugriff, auf den Workspace beschränkt
    backup.ts       Backups mit Manifest, Prüfen, Wiederherstellen
    zip.ts          ZIP lesen und schreiben (ohne Abhängigkeiten, mit Zip-Slip-Schutz)
    recovery.ts     Notfalldateien für ungespeicherten Text (im App-Profil)
  preload/        Stellt die Schnittstelle als window.notesApi bereit
  renderer/       Oberfläche: UI5 Web Components, CodeMirror mit Live Preview
    adapters/       Mock-Adapter für den Browser-Modus
tests/
  unit/           node:test, laufen gegen MemoryFs und echtes Dateisystem
  e2e/            Playwright im Browser-Modus
  electron/       Smoke-Test der gebauten App, in der CI auf allen drei Systemen
```

Der Browser-Modus und Electron verwenden dieselbe `NoteStore`-Logik. Nur das Dateisystem
darunter ist verschieden (`MemoryFs` bzw. `NodeFs`). So laufen beide Varianten nicht
auseinander. Im Electron-Build ist `__BROWSER_MODE__` gleich `false`, der Mock-Adapter wird
dadurch nicht mit ausgeliefert.

## Sprachen

- Texte stehen in `src/shared/i18n/de.ts` und `en.ts`. Code ruft `t('schlüssel', { platzhalter })`
  auf, Mehrzahl über `tp('schlüssel', anzahl)` mit den Varianten `.one` und `.other`.
- Statische Texte in `index.html` tragen `data-i18n` (Textinhalt) oder
  `data-i18n-attr="attribut:schlüssel; …"`.
- Ein Unit-Test prüft, dass jede Sprache genau dieselben Schlüssel und Platzhalter hat.
- Die Einstellung liegt in `config.json` (Browser-Modus: `localStorage`, Test-Override `?lang=en`).
  Ein Wechsel lädt das Fenster neu; das native Menü wird sofort neu aufgebaut.
- Rechts-nach-links: `dir` am `<html>` folgt der Sprache, das CSS nutzt logische Eigenschaften
  (`margin-inline-start` usw.). Eine neue Sprache braucht nur eine weitere Datei in `i18n/`.

## Wie Dateien benannt werden

- Jede Notiz hat eine feste ID (ULID) im Front Matter. Links, Historie und Backups hängen
  an dieser ID, nicht am Dateinamen.
- Der Dateiname folgt dem Titel: `einkauf-samstag--a3f9k2.md`. Die letzten 6 Zeichen
  stammen aus der ID, deshalb gibt es nie zwei gleiche Namen.
- Gespeichert wird 0,7 Sekunden nach dem letzten Tastendruck, umbenannt nach 4 Sekunden
  Pause oder beim Wechsel der Notiz.
- Dateien ohne ID (z. B. von außen hineinkopiert) bekommen beim ersten Speichern eine.
- Fremde Front-Matter-Zeilen bleiben unverändert erhalten.

## Barrierefreiheit

- F6 und Shift+F6 springen zwischen Bibliothek, Notizliste und Editor.
- Im Editor rückt Tab ein. Esc und danach Tab verlässt den Editor.
- Themes: Hell, Dunkel, Hoher Kontrast schwarz und weiß. "System folgen" erkennt
  auch Kontrastdesigns des Betriebssystems.
- Speicherstatus und Fehler werden über Live-Regionen angesagt.
- In schmalen Fenstern (eine Spalte) führen Zurück-Knöpfe vom Editor zur Liste und von
  der Liste zur Bibliothek.
- Automatische Prüfung (axe, Tastatur, Reflow) und Checkliste für Screenreader:
  [docs/accessibility.md](docs/accessibility.md).

## Sicherheit

- Renderer ohne Node-Zugriff (`contextIsolation`, `sandbox`), IPC nur vom eigenen Fenster,
  Argumente werden im Main-Prozess geprüft.
- Alle Netzwerkanfragen werden blockiert. Links öffnen im Standardbrowser.
- Content-Security-Policy ohne Inline-Skripte. Inline-Styles sind vorerst erlaubt
  (UI5, CodeMirror). Das wird in Phase 4 geprüft und verschärft.

## Bekannte offene Punkte

- **UI5-Version:** UI5 ist exakt auf 2.27.2 gepinnt. Der Tokenizer-Fehler aus 2.27.2
  (Render-Schleife bei sehr vielen Labels an einer Notiz) ist erst ab 2.28.0 behoben.
  Update, sobald 2.28.0 erscheint.
- **Schrift 72:** `copy-fonts.mjs` sucht die Dateien in den UI5-Theming-Paketen. Findet es
  keine, nutzt die App Arial oder Helvetica. Die Konsole meldet das beim Installieren.
- **Backups** sind nicht verschlüsselt. Liegt der Backup-Ordner in einer Cloud, sind die
  Notizen dort im Klartext.
- **Wiki-Markup:** Aufgaben werden zu ☐/☑, weil Wiki-Markup keine Checkboxen kennt. Bilder
  müssen in Jira oder Confluence separat als Anhang hochgeladen werden.
- **PDF-Export** gibt es nur in der App, nicht im Browser-Modus.

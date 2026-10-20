# mdnotes

Lokaler Markdown-Editor im Stil von Apple Notes, gestaltet nach SAP Fiori (Horizon).
Läuft auf macOS, Windows und Linux. Notizen sind normale `.md`-Dateien in einem Ordner deiner Wahl.

Stand: MVP-Gerüst (Phase 1 des Plans).

## Schnellstart

Voraussetzung: Node.js 22 oder 24 (LTS).

```bash
npm install            # kopiert danach automatisch die Schrift "72" (scripts/copy-fonts.mjs)
npm run dev:browser    # Oberfläche im Browser mit Demo-Notizen: http://127.0.0.1:5173
npm run dev            # echte App mit Electron, Hot Reload, ohne Installer-Build
```

Nach dem ersten `npm install` die entstandene `package-lock.json` einchecken. Die CI nutzt `npm ci`.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Electron-App aus dem Quellcode, Änderungen an der Oberfläche sofort sichtbar |
| `npm run dev:browser` | Nur die Oberfläche im Browser, mit Mock-Adapter statt Dateisystem |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run test:unit` | Kernlogik gegen Speicher und echtes Dateisystem |
| `npm run test:e2e` | UI- und Barrierefreiheitstests im Browser-Modus (Playwright, axe) |
| `npm run package` | Installer für das aktuelle System (`release/`) |

Beim ersten E2E-Lauf einmal `npx playwright install chromium` ausführen.

## Aufbau

```
src/
  shared/         Kernlogik ohne Abhängigkeiten, läuft überall
    note.ts         ULID, Dateiname, Titel, Front Matter
    note-store.ts   Anlegen, Speichern, Umbenennen nach Titel
    fs-port.ts      Dateisystem-Schnittstelle + MemoryFs
    api.ts          Schnittstelle zwischen Oberfläche und Dateisystem
  main/           Electron-Hauptprozess: Fenster, Menü, IPC, NodeFs, Sicherheit
  preload/        Stellt die Schnittstelle als window.notesApi bereit
  renderer/       Oberfläche: UI5 Web Components, CodeMirror mit Live Preview
    adapters/       Mock-Adapter für den Browser-Modus
tests/
  unit/           node:test, laufen gegen MemoryFs und echtes Dateisystem
  e2e/            Playwright im Browser-Modus
```

Der Browser-Modus und Electron verwenden dieselbe `NoteStore`-Logik. Nur das Dateisystem
darunter ist verschieden (`MemoryFs` bzw. `NodeFs`). So laufen beide Varianten nicht
auseinander. Im Electron-Build ist `__BROWSER_MODE__` gleich `false`, der Mock-Adapter wird
dadurch nicht mit ausgeliefert.

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

## Sicherheit

- Renderer ohne Node-Zugriff (`contextIsolation`, `sandbox`), IPC nur vom eigenen Fenster,
  Argumente werden im Main-Prozess geprüft.
- Alle Netzwerkanfragen werden blockiert. Links öffnen im Standardbrowser.
- Content-Security-Policy ohne Inline-Skripte. Inline-Styles sind vorerst erlaubt
  (UI5, CodeMirror). Das wird in Phase 4 geprüft und verschärft.

## Bekannte offene Punkte

- **Oberfläche ungetestet:** Das Gerüst wurde ohne Zugriff auf die npm-Registry erstellt.
  Kernlogik und Tests liefen, die Oberfläche (UI5, CodeMirror, Electron) wurde noch nie
  gestartet. Beim ersten `npm run dev:browser` und `npm run test:e2e` sind kleine
  Korrekturen zu erwarten.
- **Versionen:** UI5 ist exakt auf 2.27.2 gepinnt. Der Tokenizer-Fehler aus 2.27.2 ist
  erst ab 2.28.0 behoben, relevant ab den Labels in Phase 2. Die übrigen Pakete stehen auf
  `^`-Bereichen, die `package-lock.json` fixiert sie.
- **Schrift 72:** `copy-fonts.mjs` sucht die Dateien in den UI5-Theming-Paketen. Findet es
  keine, nutzt die App Arial oder Helvetica. Die Konsole meldet das beim Installieren.
- **Kleine Fenster:** Unter etwa 600 px zeigt das Flexible Column Layout nur eine Spalte.
  Der Zurück-Knopf im Editor führt zur Liste. Die Bibliothek ist dort noch nicht erreichbar.

# Barrierefreiheit: Prüfprotokoll

Ziel: WCAG 2.2 AA, wie sie EN 301 549 (Kapitel 11, Software) verlangt.

## Automatisch in der CI

`tests/e2e/a11y.spec.ts` läuft bei jedem Push im Browser-Modus:

- **axe (WCAG 2.2 AA)** auf der Hauptansicht in allen vier Themes (Hell, Dunkel,
  Hoher Kontrast schwarz und weiß) und auf Englisch.
- **Alle Zustände:** keine Notiz gewählt, keine Treffer, Label-Ansicht, Papierkorb mit
  schreibgeschützter Notiz, Hinweis bei Änderung von außen.
- **Alle Menüs und Dialoge:** Darstellung, Weitere Aktionen, Export, Versionen mit Diff,
  Backup mit Aktionsmenü, Notizauswahl, Bestätigung „Endgültig löschen“, Eingabedialog.
- **Tastatur:** Skip-Link als erster Tab-Stopp, F6/Shift+F6 zwischen den drei Bereichen,
  Esc und danach Tab verlässt den Editor, Fokus kehrt nach dem Schließen eines Dialogs zum
  auslösenden Knopf zurück.
- **Reflow (1.4.10):** kein waagerechtes Scrollen bei 320 CSS-Pixeln Breite.
- **Textabstände (1.4.12):** erhöhte Zeilen-, Buchstaben- und Wortabstände schneiden nichts ab.

Bekannte Fehler innerhalb von UI5 stehen mit Begründung in `tests/e2e/axe.ts`
(`KNOWN_UI5_ISSUES`) und werden entfernt, sobald UI5 sie behebt.

## Manuell mit Screenreader

axe findet etwa ein Drittel der Probleme. Den Rest prüft nur ein Mensch. Einmal pro
größerem Release, je System mit dem dort üblichen Screenreader:

| System  | Screenreader | Start                       |
| ------- | ------------ | --------------------------- |
| macOS   | VoiceOver    | Cmd+F5                      |
| Windows | NVDA         | Strg+Alt+N (nach Installation) |
| Linux   | Orca         | Super+Alt+S (GNOME)         |

Bei jedem Punkt: Was wird angesagt? Stimmt es mit dem überein, was man sieht?

### Start und Orientierung

- [ ] Fenstertitel und Bereiche werden angesagt: „Bibliothek“ (Navigation),
      „Notizen“ (Region), „Editor“ (Hauptbereich).
- [ ] Der erste Tab-Stopp ist „Zum Editor springen“. Enter springt in den Editor oder,
      ohne offene Notiz, in die Notizliste.
- [ ] F6 und Shift+F6 springen zwischen Shellbar, Bibliothek, Notizliste und Editor.

### Notizliste

- [ ] Pfeiltasten bewegen durch die Liste. Angesagt werden Titel, Vorschau und Datum.
- [ ] Die offene Notiz ist als aktuelle erkennbar („aktiv“ bzw. „navigated“).
- [ ] Die Suche hat einen Namen („Notizen durchsuchen“). Bei keinem Treffer wird
      „Keine Treffer“ vorgelesen.

### Editor

- [ ] Beim Betreten: „Notizinhalt, Markdown-Editor. Die erste Zeile ist der Titel …“.
- [ ] Getippter Text wird vorgelesen. Überschriften und Listen bleiben als Text lesbar
      (die Live Preview blendet Zeichen nur außerhalb der Cursorzeile aus).
- [ ] Aufgaben-Kästchen: „Aufgabe offen“ bzw. „Aufgabe erledigt“, umschaltbar.
- [ ] Code-Block: Sprachauswahl und „Code kopieren“ sind erreichbar, „Code kopiert“
      wird angesagt.
- [ ] Bild einfügen: Der Dialog „Bildbeschreibung“ öffnet sich, der Fokus steht im Feld.
- [ ] Speicherstatus („Speichert …“, „Gespeichert um …“) wird höflich angesagt,
      ohne das Tippen zu unterbrechen.
- [ ] Esc, danach Tab verlässt den Editor (keine Tastaturfalle).

### Labels

- [ ] Das Label-Feld heißt „Labels der Notiz“. Vorschläge werden angesagt.
- [ ] Ein Label lässt sich mit Rücktaste oder Entf entfernen. Die Änderung ist hörbar.

### Dialoge

- [ ] Beim Öffnen wird der Titel angesagt, der Fokus steht im Dialog.
- [ ] Tab bleibt im Dialog. Esc schließt ihn. Der Fokus kehrt zum Auslöser zurück.
- [ ] Versionen: Die Liste ist bedienbar. Die Zusammenfassung („2 Änderungen: …“) wird
      nach der Auswahl angesagt. Beide Diff-Seiten haben einen Namen.
- [ ] Backup: Auswahl „Automatisch sichern“ hat eine Beschriftung, „Backup gespeichert“
      wird angesagt.

### Meldungen

- [ ] Fehler (z. B. Speichern fehlgeschlagen) werden sofort angesagt (assertive).
- [ ] Hinweise zu Änderungen von außen sind mit Tab erreichbar, ihre Knöpfe sind benannt.
- [ ] Toasts wie „In den Papierkorb verschoben“ werden zusätzlich über die Live-Region
      angesagt, weil Toasts allein schnell verschwinden.

## Manuell ohne Screenreader

- [ ] **Nur Tastatur:** Alles von Neue Notiz über Labels, Export und Backup bis zum
      Wiederherstellen aus dem Papierkorb geht ohne Maus. Der Fokus ist immer sichtbar.
- [ ] **Zoom 200 % und 400 %** (Cmd/Strg und +): Nichts überlappt. Bei 400 % zeigt das
      Layout eine Spalte, der Zurück-Knopf führt zur Liste.
- [ ] **Kontrastdesigns des Systems** (Windows: Kontrastdesigns, macOS: Kontrast
      erhöhen): Mit „System folgen“ wechselt die App auf Hoher Kontrast.
- [ ] **Bewegung reduzieren** im System: keine Animationen.
- [ ] **Sprache Englisch:** Alle Texte und Ansagen wechseln, auch Menü und Dialoge des
      Systems (Ordnerwahl).

## Ergebnisse

| Datum | System / Screenreader | Version | Ergebnis / Befunde |
| ----- | --------------------- | ------- | ------------------ |
| 2026-10-22 | macOS 27.0.1 (26A434) / VoiceOver | Phase 4 (`feat/strict-csp`, fb4cd62), Dev-Modus | Start und Orientierung, Editor (Aufgaben, Code-Block, Bild mit Beschreibung), Dialoge, Labels, Meldungen und Sprachwechsel: bestanden, keine Befunde |
| | Windows / NVDA | | noch offen |
| | Linux / Orca | | noch offen |

# Fahrplan

Die geordnete Liste aller offenen Pakete: Phase 5 („Alltag und Komfort“) und die Design-Überarbeitung (D1 bis D7).
Jeder Eintrag ist ein PR und ein GitHub-Issue. Toni bestimmt die Reihenfolge, dieses Dokument hält sie fest.
Den Status zeigen die Issues und Meilensteine: Ein PR schließt sein Issue mit `Closes #n` in der Beschreibung.

Hintergrund und Begründungen stehen in den claude.ai Artifacts „Plan: Markdown-Editor“ (Backlog Phase 5)
und „Plan: Design-Überarbeitung mdnotes“.

## Meilenstein Phase 5.1: Design-Grundlage

1. #14 **D1 Split-Ansicht nach Spaltenbreite.** `@container` auf `.editor-column` statt `@media` auf das Fenster.
2. #15 **D3 Sprachauswahl aus „Darstellung“.** Eigenes Shellbar-Symbol (Globus) mit flachem Menü. Es bleibt bei vier Shellbar-Einträgen,
   Fallback bei Problemen ist ein Einstellungen-Dialog.
3. #16 **D7 UI5 für alle Bedienelemente.** Code-Werkzeuge auf `ui5-select` und `ui5-button`. Aufgaben-Kästchen zuerst als Spike mit
   `ui5-checkbox`, fällt er durch, bleibt das native Element und die Begründung kommt in `CLAUDE.md`.

## Meilenstein Phase 5.2: Schreiben und Ordnen

4. #17 **Phase 5, Punkt 1 zusammen mit D2.** Formatier-Kürzel (Cmd+B/I/K, Cmd+Shift+X) und Toolbar, dazu die neue Editor-Kopfzeile:
   Dateiname raus, Menü „Weitere Aktionen“ mit „Dateiname kopieren“, Speicherstatus neben die Aktionen, `ui5-toolbar` mit Overflow.
5. #18 **Phase 5, Punkt 2 zusammen mit D4.** Anheften und Sortieren (Entscheidung offen: `pinned` im Front Matter oder in `config.json`)
   und Datumsgruppen wie in Apple Notes. Angeheftete Notizen bilden die erste Gruppe. Bei Suche und bei Sortierung nach Titel keine Gruppen.
6. #19 **Phase 5, Punkt 3.** „Rückgängig“ nach dem Löschen.
7. #20 **Phase 5, Punkt 4.** Tastenkürzel-Übersicht (Cmd+/).

## Meilenstein Phase 5.3: Politur

8. #21 **D5 Zielgrößen und Tokens.** Test für die Mindestgröße 24 × 24 px (WCAG 2.2 AA, 2.5.8), feste Rundungen durch Theme-Token ersetzen.
   Kann früher zwischen die Features geschoben werden.
9. #22 **D6 Bibliothek und Status.** Zähler an „Alle Notizen“, Workspace-Pfad vorne gekürzt, „Neue Notiz“ mit Text bei breiter Spalte und
   nur als Symbol bei schmaler Spalte, Speicherstatus nach einigen Sekunden dezent. Kann früher eingeschoben werden.

## Meilenstein Phase 5.4: Vernetzen

- #23 Phase 5, Punkt 5: `[[Links]]` mit Rückverweisen (braucht vermutlich `@codemirror/autocomplete`, also Lockfile vom Mac).
- #24 Phase 5, Punkt 6: Gliederung.
- #25 Phase 5, Punkt 7: Tabellen bearbeiten (Rendern in der Live Preview ist mit PR #11 erledigt).
- #26 Phase 5, Punkt 8: Wörter und Zeichen zählen.
- #27 Phase 5, Punkt 9: Notiz duplizieren und Vorlagen (Eintrag „Duplizieren“ im Menü „Weitere Aktionen“ aus D2).

## Meilenstein Später

- #28 Phase 5, Punkt 10: Mathe, Mermaid, Fußnoten (neue Pakete, strenge CSP beachten).
- #29 Phase 5, Punkt 11: Anhänge außer Bildern, mit Größenlimit.
- #30 Phase 5, Punkt 12: Mehrere Notizen in Tabs oder Fenstern.
- #31 Backups verschlüsseln (optional).
- #32 Blockweises Wiederherstellen aus einer Version.

## Vor D2 und D4

Screenshots der App (hell, dunkel, Split-Ansicht) ansehen, damit der Entwurf nicht am Bild vorbei geht.

# Fahrplan

Die geordnete Liste der offenen Pakete. Jedes Paket ist ein GitHub-Issue und genau ein PR, der es mit `Closes #n` schließt.
Toni ist Product Owner und Tester: Er legt Issues an, bestimmt die Reihenfolge und gibt frei. Den Status zeigen Issues und Labels.

Hintergrund und Begründungen stehen in den claude.ai Artifacts „Plan: Markdown-Editor“ (Backlog Phase 5)
und „Plan: Design-Überarbeitung mdnotes“. Neue Issues werden auf Englisch geschrieben.

## Stand (25. November 2026)

Erledigt: Phase 5.1 bis 5.4 und die Design-Überarbeitung D1 bis D7 (#14 bis #28), dazu #36 bis #39, #45, #48, #53, #54,
#69, #74 und #77. #29 (Anhänge) schließt PR #80.

**Als Nächstes, in dieser Reihenfolge:** nichts freigegeben. Neue Issues ohne Label kommen nach Nummer dran.

**Zurückgestellt (Label `later`):**

- #30 Mehrere Notizen in Tabs oder Fenstern (Phase 5, Punkt 12).
- #31 Backups verschlüsseln (optional).
- #32 Blockweises Wiederherstellen aus einer Version.

## Automatisierung

**Ablauf.** Ein Issue nach dem anderen:

1. Der Umsetzer nimmt das nächste freigegebene Issue, setzt es auf einem Branch `feat/…` oder `fix/…` um und öffnet einen PR mit `Closes #n`.
2. Der Review-Agent reviewt den PR. Der Umsetzer behebt die Befunde, danach reviewt der Review-Agent erneut.
3. Ist die CI grün und kein Befund mehr offen, mergt der Review-Agent den PR.
4. Der Merge weckt den Umsetzer, und er nimmt sofort das nächste Issue.

Solange ein PR offen ist, beginnt der Umsetzer nichts Neues. Die Kette wartet bewusst auf das Review.

**Freigabe.** Freigegeben sind alle offenen Issues ohne die Labels `later` und `needs-owner-decision`.
Zuerst kommen die Issues aus „Als Nächstes“ in dieser Reihenfolge, danach die übrigen nach Issue-Nummer.
Toni gibt ein zurückgestelltes Issue frei, indem er `later` entfernt, und hält eines zurück, indem er `later` setzt.
Issues zu den geplanten Aufgaben selbst (`chore(automation)`) nimmt der Umsetzer nicht. Sie werden mit Toni im Chat geklärt.

| Rolle | Wer | Zeitplan |
| --- | --- | --- |
| Umsetzer | geplante Aufgabe „mdnotes issue implementer“, Claude Opus | werktags stündlich von 9 bis 14 Uhr (Europe/Berlin), dazu bei jedem Ereignis an seinem PR |
| Review und Merge | GPT-Agent, markiert seine Reviews mit `<!-- reviewed-sha: <sha> -->` | eigener Zeitplan außerhalb dieses Repos |
| Product Owner, Tester | Toni | legt Issues an, gibt frei, beantwortet offene Entscheidungen |

Der stündliche Lauf ist der Fallback. Findet er kein freigegebenes Issue, endet er nach wenigen Sekunden mit „nichts zu tun“.
Eine Änderung an einem Issue (neues Issue, `later` entfernt) greift also spätestens beim nächsten Lauf.

**Regeln.**

- Wer ein Issue umsetzt, reviewt es nicht selbst.
- Fehlersuche höchstens zwei CI-Runden. Danach folgt eine offene Entscheidung statt weiterer Versuche.
- **Offene Entscheidungen:** Braucht ein Issue oder PR eine Entscheidung von Toni, setzt der Agent das Label `needs-owner-decision`
  und schreibt einen Kommentar mit der Frage und zwei bis drei Optionen. Nach Tonis Antwort entfernt er das Label und macht weiter.
- **Neue Pakete** (`package.json`, `package-lock.json`) sind erlaubt, wenn das Lockfile geprüft ist: nur die neuen Pakete,
  keine bestehende Version geändert, alles von registry.npmjs.org. Sonst ist es eine offene Entscheidung.
- **Bei Toni bleiben** Änderungen an Workflows unter `.github/`, an der Release-Konfiguration und an `AGENTS.md`.
  Solche PRs mergt der Review-Agent nicht.

**Abgebrochene CI-Jobs:** Wird ein Job abgebrochen („not acquired by Runner“, meist macOS), startet
`.github/workflows/rerun-cancelled.yml` den Lauf einmal neu. Ein zweiter Abbruch wird gemeldet, nicht erneut gestartet.

**Installer:** Der Job „Build installers“ läuft bei jedem Push auf `main` ohne Abhängigkeit von der Test-Matrix,
damit ein abgebrochener Testjob keine macOS-Installer verhindert. Getestet wird vor dem Merge im PR.

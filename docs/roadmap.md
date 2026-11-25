# Roadmap

The ordered list of all open packages: phase 5 ("everyday use and comfort") and the design revision (D1 to D7).
Each entry is one PR and one GitHub issue. Toni decides the order; this document records it.
The status is shown by the issues and milestones: a PR closes its issue with `Closes #n` in the description.

Background and reasoning are in the claude.ai Artifacts "Plan: Markdown-Editor" (phase 5 backlog)
and "Plan: Design-Überarbeitung mdnotes".

## Status (8 November 2026)

Done: #14 D1, #15 D3, #16 D7, #17 formatting and toolbar, #36, #37, #39, #45, #38 (logo).
Everything in the repository is written in English (see `CLAUDE.md`, "Way of working").

**Next, in this order:**

1. Finish PR #52 (#18 pinning, sorting, date groups). The agent stopped at the session limit,
   the PR is a draft. Check CI (the macOS job was cancelled last time), close the gaps,
   then mark it ready with `POST repos/tonitone/mdnotes/pulls/52/ccr/ready_for_review`.
2. PR #50 (#48 scrolling editor, axe) is ready. It is waiting for review and merge.
   Open: the entry for the target size of `ui5-select` in `KNOWN_UI5_ISSUES` is re-measured in #21.
3. #53 (bug): A collapsed library column opens again when a note is opened or the logo is clicked.
   It should stay closed until Toni opens it again.
4. #54: In the wide window, clicking the logo should not close the open note, only switch the list to
   "All notes".
5. Then #19, #20 (phase 5.2), #21 and #22 (phase 5.3), then phase 5.4.

**Way of working:**

- Models and roles are defined in `AGENTS.md` (rule 7): implementation and planning on Opus, review by a GPT agent,
  both at high effort.
- At most two agents at the same time; split large issues.
- Debugging at most two CI rounds. After that, report instead of trying further.
- The GPT reviewer reviews, fixes and merges PRs with `Closes #n`. The former scheduled task
  "mdnotes PR review and fix loop" no longer exists. Agents mark their PRs ready themselves once CI is green.
- Since 24 November 2026 it also merges PRs with new packages (`package.json`, `package-lock.json`) itself
  once the lockfile has been checked: only the new packages, no existing version changed, everything from
  registry.npmjs.org. Changes to workflows under `.github/` and to the release configuration stay with Toni.

## Milestone Phase 5.1: design foundation

1. #14 **D1 split view by column width.** `@container` on `.editor-column` instead of `@media` on the window.
2. #15 **D3 language selection out of "Appearance".** Its own shellbar icon (globe) with a flat menu. The shellbar keeps four entries;
   the fallback if there are problems is a settings dialog.
3. #16 **D7 UI5 for all controls.** Code tools on `ui5-select` and `ui5-button`. Task checkbox first as a spike with
   `ui5-checkbox`; if it fails, the native element stays and the reasoning goes into `CLAUDE.md`.

## Milestone Phase 5.2: writing and organizing

4. #17 **Phase 5, item 1 together with D2.** Formatting shortcuts (Cmd+B/I/K, Cmd+Shift+X) and toolbar, plus the new editor header:
   file name removed, "More actions" menu with "Copy file name", save status next to the actions, `ui5-toolbar` with overflow.
5. #18 **Phase 5, item 2 together with D4.** Pinning and sorting (open decision: `pinned` in the front matter or in `config.json`)
   and date groups as in Apple Notes. Pinned notes form the first group. No groups while searching or when sorting by title.
6. #19 **Phase 5, item 3.** "Undo" after deleting.
7. #20 **Phase 5, item 4.** Keyboard shortcut overview (Cmd+/).

## Milestone Phase 5.3: polish

8. #21 **D5 target sizes and tokens.** Test for the minimum size of 24 × 24 px (WCAG 2.2 AA, 2.5.8), replace fixed radii with theme tokens.
   Can be moved earlier between the features.
9. #22 **D6 library and status.** Counter on "All notes", workspace path shortened at the front, "New note" with text in a wide column and
   icon only in a narrow column, save status turns subtle after a few seconds. Can be moved earlier.

## Milestone Phase 5.4: linking

- #23 Phase 5, item 5: `[[links]]` with backlinks (probably needs `@codemirror/autocomplete`, so a lockfile from the Mac).
- #24 Phase 5, item 6: outline.
- #25 Phase 5, item 7: editing tables (rendering in the Live Preview is done with PR #11).
- #26 Phase 5, item 8: counting words and characters.
- #27 Phase 5, item 9: duplicate a note and templates ("Duplicate" entry in the "More actions" menu from D2).

## Milestone Later ("Später")

- #28 Phase 5, item 10: math, Mermaid, footnotes (new packages, mind the strict CSP).
- #29 Phase 5, item 11: attachments other than images, with a size limit.
- #30 Phase 5, item 12: several notes in tabs or windows.
- #31 Encrypt backups (optional).
- #32 Block-wise restore from a version.

## Before D2 and D4

Look at screenshots of the app (light, dark, split view) so the design does not miss the actual picture.

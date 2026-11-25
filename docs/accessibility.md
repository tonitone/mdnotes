# Accessibility: audit log

Goal: WCAG 2.2 AA, as required by EN 301 549 (chapter 11, software).

UI texts below are quoted from the English catalog (`src/shared/i18n/en.ts`). The automated tests run in German;
the manual checks apply to both languages.

## Automated in CI

`tests/e2e/a11y.spec.ts` runs on every push in browser mode:

- **axe (WCAG 2.2 AA)** on the main view in all four themes (light, dark,
  high contrast black and white) and in English.
- **All states:** no note selected, no results, label view, trash with a
  read-only note, notice about a change from outside, note list with date groups and
  a pinned note (light and high contrast black).
- **All menus and dialogs:** Appearance, Language, More actions, Sort, a note's context menu, Export, Versions with diff,
  Backup with action menu, note picker, "Delete permanently" confirmation, input dialog.
- **Keyboard:** skip link as the first tab stop, F6/Shift+F6 between the three areas,
  Esc then Tab leaves the editor, focus returns to the triggering button after a dialog
  closes.
- **Reflow (1.4.10):** no horizontal scrolling at a width of 320 CSS pixels.
- **Text spacing (1.4.12):** increased line, letter and word spacing does not clip anything.

Known bugs inside UI5 are listed with their reasoning in `tests/e2e/axe.ts`
(`KNOWN_UI5_ISSUES`) and are removed as soon as UI5 fixes them.

## Manual, with a screen reader

axe finds about a third of the problems. Only a person can check the rest. Once per
larger release, on each system with its usual screen reader:

| System  | Screen reader | Start                         |
| ------- | ------------- | ----------------------------- |
| macOS   | VoiceOver     | Cmd+F5                        |
| Windows | NVDA          | Ctrl+Alt+N (after installing) |
| Linux   | Orca          | Super+Alt+S (GNOME)           |

For every item: what is announced? Does it match what is visible?

### Start and orientation

- [ ] The window title and the areas are announced: "Library" (navigation),
      "Notes" (region), "Editor" (main).
- [ ] The first tab stop is "Skip to editor". Enter jumps into the editor or,
      without an open note, into the note list.
- [ ] F6 and Shift+F6 jump between shellbar, library, note list and editor.
- [ ] The logo in the shellbar is announced as the link "mdnotes", in the wide and in the narrow
      window (below about 700 px), and only once. Enter or Space leads to "All notes":
      focus is in the note list, an open note stays open (behind the list in the narrow
      window), an open trash entry is closed.

### Note list

- [ ] The arrow keys move through the list. Title, preview and date are announced.
- [ ] The open note is recognizable as the current one ("active" or "navigated").
- [ ] The search has a name ("Search notes"). With no match,
      "No results" is read out.
- [ ] Date groups (`ui5-li-group`): when moving into a group, its name is announced
      ("Pinned", "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", month, year).
      The group headers can be reached with the arrow keys; VoiceOver names the group as a list.
- [ ] A pinned note announces "pinned" after the title, also without groups
      (sorting by title, search, trash).
- [ ] A note's context menu via Shift+F10 or the context menu key: "Pin" or
      "Unpin". After choosing, focus is back on the same note and the change
      is announced ("“Shopping” pinned."). The trash has no context menu.
- [ ] The button "Sort: Date modified" opens the menu "Sort by" with three
      choices (Date modified, Date created, Title); the chosen one is announced as selected.
      The new sort order is announced ("Sorted by Title.").

### Editor

- [ ] On entering: "Note content, Markdown editor. The first line is the title …".
- [ ] Typed text is read out. Headings and lists stay readable as text
      (the Live Preview hides characters only outside the cursor line).
- [ ] Task checkbox: "Task open" or "Task done", toggleable.
- [ ] Code block: the language selection and "Copy code" are reachable, "Code copied"
      is announced.
- [ ] Inserting an image: the dialog "Image description" opens, focus is in the field.
- [ ] The save status ("Saving …", "Saved at …") is announced politely,
      without interrupting typing.
- [ ] Esc, then Tab leaves the editor (no keyboard trap).

### Formatting

Shortcuts in the editor (Cmd instead of Ctrl on the Mac): Ctrl+B bold, Ctrl+I italic, Ctrl+K link,
Ctrl+Shift+X strikethrough. Ctrl+I thereby replaces CodeMirror's "Select parent syntax".
Further actions are in the formatting toolbar (`ui5-toolbar`: Heading, List,
Task, Table, Code, Link); bold, italic and strikethrough are also in the menu
"More actions" > "Format", there with the shortcut.

- [ ] Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+Shift+X: "Bold on/off" etc. is announced.
- [ ] The formatting toolbar has the name "Formatting", every button has a name (the tooltip shows the shortcut).
- [ ] In the toolbar, the arrow keys, Home and End move between the buttons.
- [ ] After a toolbar button or an entry in the "Format" menu, focus is back in the editor.
- [ ] In a very narrow window, the last buttons move into the toolbar's overflow menu and
      stay usable there with mouse and keyboard.
- [ ] In the "Format" menu, an entry's shortcut is announced (`aria-keyshortcuts`).

### Labels

- [ ] The label field is called "Labels of this note". Suggestions are announced.
- [ ] A label can be removed with Backspace or Delete. The change is audible.

### Dialogs

- [ ] On opening, the title is announced and focus is in the dialog.
- [ ] Tab stays inside the dialog. Esc closes it. Focus returns to the trigger.
- [ ] Versions: the list is usable. The summary ("2 changes: …") is
      announced after choosing. Both diff sides have a name.
- [ ] Backup: the selection "Back up automatically" has a label, "Backup saved"
      is announced.

### Messages

- [ ] Errors (e.g. saving failed) are announced immediately (assertive).
- [ ] Notices about changes from outside can be reached with Tab, their buttons have names.
- [ ] Toasts such as "moved to the trash" are also announced via the live region,
      because toasts alone disappear quickly.

## Manual, without a screen reader

- [ ] **Keyboard only:** everything from New note through labels, pinning, sorting, export and backup to
      restoring from the trash works without a mouse. Focus is always visible.
- [ ] **Zoom 200 % and 400 %** (Cmd/Ctrl and +): nothing overlaps. At 400 % the
      layout shows one column, the back button leads to the list.
- [ ] **System contrast themes** (Windows: contrast themes, macOS: increase
      contrast): with "Follow system" the app switches to high contrast.
- [ ] **Reduce motion** in the system: no animations.
- [ ] **Language English:** all texts and announcements switch, including the system's menu and dialogs
      (folder picker).

## Results

| Date | System / screen reader | Version | Result / findings |
| ---- | ---------------------- | ------- | ----------------- |
| 2026-10-22 | macOS 27.0.1 (26A434) / VoiceOver | Phase 4 (`feat/strict-csp`, fb4cd62), dev mode | Start and orientation, editor (tasks, code block, image with description), dialogs, labels, messages and language switch: passed, no findings |
| | Windows / NVDA | | still open |
| | Linux / Orca | | still open |

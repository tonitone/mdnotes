# Notes format and file names

- Every note has a fixed ID (ULID) in the front matter. Links, history and backups hang on
  this ID, not on the file name.
- The file name follows the title: `einkauf-samstag--a3f9k2.md`. The last 6 characters come
  from the ID, so two names are never the same.
- The front matter only holds `id`, `labels`, `created` and `pinned` (written as `pinned: true`,
  left out otherwise). Foreign front matter lines are kept unchanged.
- Saving happens 0.7 seconds after the last keystroke, renaming after a pause of 4 seconds
  or when the note is switched.
- Files without an ID (for example copied in from outside) get one on the first save.
- Notes can lie in subfolders. Inside the app a note's file name is its path relative to the
  workspace root with `/` as separator on every system, for example `projekte/2026/plan--a3f9k2.md`.
  The ID stays the identity; the history in `.history/<id>/` does not depend on the folder.
- Not scanned: every folder whose name starts with `.` (`.trash`, `.history`, `.git`, …),
  `assets/` in the root and `node_modules/` at any level, and folders deeper than 10 levels.
- Symbolic links are followed. Writing replaces the link's target and keeps the link; renaming,
  moving to the trash and restoring move the link, never the target. Deleting a note never deletes
  a linked file.
- The trash is flat. A note from a subfolder comes back into the workspace root.

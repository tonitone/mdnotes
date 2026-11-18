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

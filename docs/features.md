# Features

The detailed feature list. The README has the short version.

- Create notes, title from the first line, autosave, file name follows the title
- Live preview: headings, emphasis, links, lists, tasks, quotes, images, tables
- Formatting toolbar and shortcuts (Cmd/Ctrl+B, I, K, Shift+X)
- Labels with suggestions, filter by label in the library, rename or merge labels across all notes
- Pin notes, sort order (modified, created, title), date groups in the note list like Apple Notes
- Images by paste or drag, stored in `assets/`, with a prompt for an image description
- Code blocks with syntax highlighting, language picker and copy button
- Full-text search over title and content, hits with a text snippet
- Trash (`.trash/`, 30 days), restore and delete forever, undo after moving a note to the trash
- Outline of the headings (Cmd/Ctrl+Shift+O), word and character count, table editing with Tab, Shift+Tab and Enter
- Keyboard shortcut overview (Cmd/Ctrl+/)
- Export a note as Markdown (with images), Jira/Confluence wiki markup or PDF;
  wiki markup and Markdown also straight to the clipboard
- Export all notes to a new folder, import Markdown files (from the menu with image import,
  or by dragging them into the window)
- Changes from outside (another editor, a sync tool) are detected; on simultaneous
  editing the app asks which version wins
- Themes light, dark and two high-contrast variants, density compact or cozy
- Versions: created automatically after a pause in editing, compare old against current,
  restore without data loss (retention: everything for 24 hours, then daily for
  30 days, then weekly)
- Backups as ZIP with SHA-256 checksums in a folder of their own, manual, on quit or daily;
  safety copy before an import and before deleting forever; restore single notes or a whole backup
- Crash recovery: unsaved text is offered at the next start after a crash
- Labels can be renamed or merged across all notes
- UI in German or English (follows the system or is set under Appearance → Language),
  layout prepared for right-to-left languages
- Math: `$x^2$` inline and `$$ ... $$` as a block, rendered with KaTeX as MathML (no fonts, no CSS,
  no inline styles). Diagrams: a fenced block with the language `mermaid` is rendered as SVG.
  Both are loaded on first use and replace the source while the cursor is elsewhere.
  Footnotes: `[^id]` and `[^id]: text`, numbered by first reference in HTML, PDF, Word and wiki export.
  Math and diagrams are not rendered in the exports yet (the source stays as text or code).

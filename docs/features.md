# Features

The detailed feature list. The README has the short version.

- Create notes, title from the first line, autosave, file name follows the title
- Notes from subfolders of the workspace appear in the same flat list, with their folder in front of the preview
  (hidden folders, `assets/` in the root and `node_modules/` are skipped, at most 10 levels deep).
  Symbolic links to notes or folders are followed, also outside the workspace; saving keeps the link.
  New notes go into the root, renaming keeps a note in its folder, restoring from the trash puts it into the root
- Folder tree in the library, shown once a subfolder holds a note: choosing a folder lists the notes directly in it
  (count per folder, search within the folder, the trash stays global). "All notes" stays the recursive overview.
  Only folders that hold notes appear; creating, renaming or deleting folders is left to the file manager
- Live preview: headings, emphasis, links, lists, tasks, quotes, images, tables
- Formatting toolbar and shortcuts (Cmd/Ctrl+B, I, K, Shift+X)
- Labels with suggestions, filter by label in the library, rename or merge labels across all notes
- Pin notes, sort order (modified, created, title), date groups in the note list like Apple Notes
- Images by paste or drag, stored in `assets/`, with a prompt for an image description
- Attachments (PDF, documents, archives …, up to 50 MB) by paste, drag or "Attach file…" in More actions,
  stored in `assets/` and linked as `[name.pdf](assets/<hash>.pdf)`; the editor shows a chip, a click or
  Ctrl/Cmd+Enter opens the file with the system's app, the folder button or Ctrl/Cmd+Shift+Enter shows it
  in the file manager. Programs and scripts (`.exe`, `.app`, `.sh`, `.ps1`, `.jar` …) are refused
- Code blocks with syntax highlighting, language picker and copy button
- Full-text search over title and content, hits with a text snippet
- Trash (`.trash/`, 30 days), restore and delete forever, undo after moving a note to the trash
- Outline of the headings (Cmd/Ctrl+Shift+O), word and character count, table editing with Tab, Shift+Tab and Enter
- Links between notes: `[[` suggests notes, the file holds `[[<id>|<title>]]` (bound to the note ID, so renaming breaks nothing),
  the editor shows the current title, Ctrl/Cmd+Enter or a click opens the target, "Linked from" below the note lists backlinks;
  previews and HTML/PDF/Word/wiki exports show the title, Markdown export keeps the link text as is
- Keyboard shortcut overview (Cmd/Ctrl+/)
- Export a note as Markdown (with images and attachments), Jira/Confluence wiki markup or PDF;
  wiki markup and Markdown also straight to the clipboard
- Export all notes to a new folder (with their subfolders), import Markdown files (from the menu with image import,
  or by dragging them into the window)
- Changes from outside (another editor, a sync tool) are detected, also in subfolders and, when the window
  regains focus, in linked files outside the workspace; on simultaneous
  editing the app asks which version wins
- Themes light, dark and two high-contrast variants, density compact or cozy
- Versions: created automatically after a pause in editing, compare old against current,
  restore a whole version or take single changed blocks (also from several versions)
  without data loss (retention: everything for 24 hours, then daily for 30 days, then weekly)
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

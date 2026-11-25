import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { assetResolver, livePreview, tablePreview } from './live-preview';
import { diagramPreview, footnotePreview, mathPreview } from './rich-preview';
import { getLocale, t } from '../../shared/i18n';
import { cspNonce } from './csp';
import { linkPreview, noteLinks, type LinkHandlers } from './wikilinks';
import { tableKeymap } from './table-commands';
import { attachments, type AttachmentHandlers } from './attachments';
import { attachmentMarkdown, fileKind } from '../../shared/assets';
import { formatCommand, formatKeymap, type FormatHooks } from './format-commands';
import type { FormatKind, FormatOutcome } from './format';

/**
 * CodeMirror editor with live preview. All colors and fonts come from the
 * SAP theme variables, so the editor follows every theme switch (light,
 * dark, high contrast) automatically.
 */

const fioriTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--sapTextColor)',
    backgroundColor: 'var(--sapBaseColor)',
    fontFamily: 'var(--sapFontFamily)',
    fontSize: 'var(--sapFontLargeSize)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  '.cm-content': {
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '1.5rem 2rem 6rem',
    caretColor: 'var(--sapTextColor)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--sapTextColor)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--sapSelectedColor)',
  },
  '.cm-placeholder': { color: 'var(--sapContent_LabelColor)', fontStyle: 'italic' },
  '.cm-panels': { backgroundColor: 'var(--sapPageHeader_Background)', color: 'var(--sapTextColor)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--sapGroup_TitleBorderColor)' },
  '.cm-searchMatch': { backgroundColor: 'var(--sapHighlightColor)', color: 'var(--sapHighlightTextColor)' },
  '.cm-searchMatch-selected': { outline: '2px solid var(--sapContent_FocusColor)' },
});

const codeHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.keyword, color: 'var(--sapInformativeTextColor, var(--sapInformativeColor))' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sapPositiveTextColor)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sapCriticalTextColor)' },
  { tag: [tags.comment, tags.meta], color: 'var(--sapContent_LabelColor)', fontStyle: 'italic' },
  // Link color is too light on the code block background in dark themes (axe); weight marks functions instead.
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--sapTextColor)', fontWeight: 'bold' },
  { tag: [tags.typeName, tags.className], color: 'var(--sapNegativeTextColor)' },
  { tag: tags.processingInstruction, color: 'var(--sapContent_LabelColor)' },
  { tag: tags.url, color: 'var(--sapLinkColor)' },
]);

export interface NoteEditor {
  readonly view: EditorView;
  /** Loads a note. A fresh state per note gives each note its own undo history. */
  setDoc(text: string, options?: { readOnly?: boolean }): void;
  getDoc(): string;
  focus(): void;
  /** Live preview on (rendered Markdown) or off (plain source, e.g. next to the preview pane). */
  setLivePreview(on: boolean): void;
  /** Applies a Markdown format to the selection. Returns false when the editor is read-only. */
  format(kind: FormatKind): boolean;
  /** Stores files and inserts them at the cursor: images inline, other files as attachment links. */
  insertFiles(files: File[]): Promise<void>;
}

export interface EditorOptions {
  onChange: (doc: string) => void;
  /** Maps an image `src` from the note to a URL the editor can show. */
  resolveAsset: (src: string) => string | null;
  /** Stores pasted or dropped images; returns their relative paths. */
  saveImages: (files: File[]) => Promise<string[]>;
  /** Called after images were inserted, with the position of each `![` and its path. */
  onImagesInserted: (inserted: Array<{ from: number; path: string }>) => void;
  /** Stores pasted or dropped files that are not images; returns their names and relative paths. */
  saveAttachments: (files: File[]) => Promise<Array<{ name: string; path: string }>>;
  /** Opens or reveals a stored attachment. */
  attachments: AttachmentHandlers;
  /** Called after a shortcut or toolbar action changed the text. */
  onFormat: (outcome: FormatOutcome) => void;
  /** Notes a `[[link]]` can point to, and how to open one. */
  links: LinkHandlers;
}

function droppedFiles(data: DataTransfer | null): File[] {
  // Markdown files are imported as notes (app.ts), not attached.
  return data ? [...data.files].filter((f) => !/\.(md|markdown)$/i.test(f.name)) : [];
}

/**
 * True while the note that was open when an insert started is still the one in
 * the editor. Storing files is asynchronous; if the user opened another note in
 * the meantime, the insert is dropped instead of landing in the wrong note.
 */
type StillCurrent = () => boolean;

/** Inserts `[name](path)` for each stored attachment at `pos`, one per line. */
async function insertAttachments(
  view: EditorView,
  files: File[],
  pos: number,
  options: EditorOptions,
  stillCurrent: StillCurrent,
): Promise<void> {
  const saved = await options.saveAttachments(files);
  if (saved.length === 0 || !stillCurrent() || view.state.readOnly) return;
  pos = Math.min(pos, view.state.doc.length);
  const line = view.state.doc.lineAt(pos);
  const before = pos > line.from ? '\n' : '';
  const after = pos < line.to ? '\n' : '';
  const markdown = saved.map(({ name, path }) => attachmentMarkdown(name, path)).join('\n');
  view.dispatch({
    changes: { from: pos, insert: before + markdown + after },
    selection: { anchor: pos + before.length + markdown.length },
    scrollIntoView: true,
  });
}

/**
 * Images become `![](…)`, everything else an attachment link (`fileKind` decides,
 * the same rule the app uses to store them). Unsupported images go the image way,
 * so the app reports them. Images first, then the other files.
 */
async function insertFiles(view: EditorView, files: File[], pos: number, options: EditorOptions, stillCurrent: StillCurrent): Promise<void> {
  const isImage = (f: File) => fileKind(f.name, f.type).kind !== 'attachment';
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  if (images.length > 0) {
    await insertImages(view, images, pos, options, stillCurrent);
    pos = view.state.selection.main.head;
  }
  if (others.length > 0) await insertAttachments(view, others, pos, options, stillCurrent);
}

/** Inserts `![](path)` for each stored image at `pos`, one per line. */
async function insertImages(
  view: EditorView,
  files: File[],
  pos: number,
  options: EditorOptions,
  stillCurrent: StillCurrent,
): Promise<void> {
  const paths = await options.saveImages(files);
  if (paths.length === 0 || !stillCurrent() || view.state.readOnly) return;
  pos = Math.min(pos, view.state.doc.length);
  const line = view.state.doc.lineAt(pos);
  // Put images on their own line so the live preview can render them.
  const before = pos > line.from ? '\n' : '';
  const after = pos < line.to ? '\n' : '';
  const markdown = paths.map((p) => `![](${p})`).join('\n');
  view.dispatch({
    changes: { from: pos, insert: before + markdown + after },
    selection: { anchor: pos + before.length + markdown.length },
    scrollIntoView: true,
  });
  let offset = pos + before.length;
  const inserted = paths.map((path) => {
    const item = { from: offset, path };
    offset += `![](${path})`.length + 1;
    return item;
  });
  options.onImagesInserted(inserted);
}

export function createEditor(parent: HTMLElement, options: EditorOptions): NoteEditor {
  const formatHooks: FormatHooks = {
    labels: () => ({ tableColumn: t('format.tableColumn') }),
    onFormat: options.onFormat,
  };
  const preview = new Compartment();
  let previewOn = true;
  // Counts loaded notes (setDoc); a pending file insert only applies to the note it started in.
  let generation = 0;
  const currentGuard = (): StillCurrent => {
    const started = generation;
    return () => generation === started;
  };
  const previewExtension = () =>
    previewOn ? [livePreview, tablePreview, linkPreview, mathPreview, diagramPreview, footnotePreview] : [];
  const readOnlyExtension = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];

  const extensions = (isReadOnly: boolean): Extension[] => [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    cspNonce(),
    search({ top: true }),
    highlightSelectionMatches(),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(codeHighlight),
    assetResolver.of(options.resolveAsset),
    noteLinks(options.links),
    attachments(options.attachments),
    preview.of(previewExtension()),
    placeholder(t('editor.placeholder')),
    fioriTheme,
    readOnlyExtension(isReadOnly),
    // Highest precedence: the markdown keymap binds Enter and Tab before the keymap below.
    Prec.highest(keymap.of(tableKeymap)),
    keymap.of([
      // Esc releases focus: afterwards Tab leaves the editor (WCAG 2.1.2).
      {
        key: 'Escape',
        run: (view) => {
          (view as EditorView & { setTabFocusMode?: (to?: boolean | number) => void }).setTabFocusMode?.(2000);
          return false;
        },
      },
      // Before the default keymap, which binds Mod-i.
      ...formatKeymap(formatHooks),
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({
      // Makes the scrolling `.cm-scroller` keyboard reachable for axe (scrollable-region-focusable, WCAG 2.1.1).
      // The rule passes when the scroller has a tabbable descendant, and axe-core (getTabbableElements ->
      // isFocusable -> isNativelyFocusable) counts only native controls and elements with a tabindex there;
      // contenteditable is checked only on the scroller itself. Browsers already put `.cm-content` in the tab
      // order, so this adds no tab stop; a read-only note (contenteditable=false) becomes focusable, so its
      // text can be scrolled with the keyboard as well. CodeMirror sets no tabindex of its own here.
      tabindex: '0',
      'aria-label': t('editor.contentLabel'),
      'aria-describedby': 'editor-help',
      spellcheck: 'true',
      lang: getLocale(),
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const files = droppedFiles(event.clipboardData);
        if (files.length === 0 || view.state.readOnly) return false;
        event.preventDefault();
        void insertFiles(view, files, view.state.selection.main.head, options, currentGuard());
        return true;
      },
      drop(event, view) {
        const files = droppedFiles(event.dataTransfer);
        if (files.length === 0 || view.state.readOnly) return false;
        event.preventDefault();
        // Markdown files dropped together with others are still imported by the document handler.
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void insertFiles(view, files, pos, options, currentGuard());
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
    }),
  ];

  // `root: document` is required: CodeMirror follows `assignedSlot` to find
  // its root, which for content slotted into a UI5 component is that
  // component's shadow root. Focus is then never detected and the DOM
  // selection is not kept in sync (characters land in the wrong place).
  const view = new EditorView({ parent, root: document, state: EditorState.create({ doc: '', extensions: extensions(false) }) });

  return {
    view,
    setDoc(text, opts = {}) {
      generation++;
      view.setState(EditorState.create({ doc: text, extensions: extensions(!!opts.readOnly) }));
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
    format: (kind) => formatCommand(kind, formatHooks)(view),
    insertFiles: async (files) => {
      if (view.state.readOnly) return;
      const stillCurrent = currentGuard();
      await insertFiles(view, files, view.state.selection.main.head, options, stillCurrent);
      if (stillCurrent()) view.focus();
    },
    setLivePreview(on) {
      if (on === previewOn) return;
      previewOn = on;
      view.dispatch({ effects: preview.reconfigure(previewExtension()) });
    },
  };
}

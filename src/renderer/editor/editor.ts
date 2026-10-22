import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { assetResolver, livePreview } from './live-preview';
import { t } from '../../shared/i18n';
import { cspNonce } from './csp';

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
}

export interface EditorOptions {
  onChange: (doc: string) => void;
  /** Maps an image `src` from the note to a URL the editor can show. */
  resolveAsset: (src: string) => string | null;
  /** Stores pasted or dropped images; returns their relative paths. */
  saveImages: (files: File[]) => Promise<string[]>;
  /** Called after images were inserted, with the position of each `![` and its path. */
  onImagesInserted: (inserted: Array<{ from: number; path: string }>) => void;
}

function imageFiles(data: DataTransfer | null): File[] {
  return data ? [...data.files].filter((f) => f.type.startsWith('image/')) : [];
}

/** Inserts `![](path)` for each stored image at `pos`, one per line. */
async function insertImages(view: EditorView, files: File[], pos: number, options: EditorOptions): Promise<void> {
  const paths = await options.saveImages(files);
  if (paths.length === 0) return;
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
    livePreview,
    placeholder(t('editor.placeholder')),
    fioriTheme,
    readOnlyExtension(isReadOnly),
    keymap.of([
      // Esc releases focus: afterwards Tab leaves the editor (WCAG 2.1.2).
      {
        key: 'Escape',
        run: (view) => {
          (view as EditorView & { setTabFocusMode?: (to?: boolean | number) => void }).setTabFocusMode?.(2000);
          return false;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({
      'aria-label': t('editor.contentLabel'),
      'aria-describedby': 'editor-help',
      spellcheck: 'true',
      lang: 'de',
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0 || view.state.readOnly) return false;
        event.preventDefault();
        void insertImages(view, files, view.state.selection.main.head, options);
        return true;
      },
      drop(event, view) {
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0 || view.state.readOnly) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        void insertImages(view, files, pos, options);
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
      view.setState(EditorState.create({ doc: text, extensions: extensions(!!opts.readOnly) }));
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
  };
}

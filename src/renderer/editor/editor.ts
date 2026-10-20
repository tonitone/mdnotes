import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { livePreview } from './live-preview';

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
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--sapLinkColor)' },
  { tag: [tags.typeName, tags.className], color: 'var(--sapNegativeTextColor)' },
  { tag: tags.processingInstruction, color: 'var(--sapContent_LabelColor)' },
  { tag: tags.url, color: 'var(--sapLinkColor)' },
]);

export interface NoteEditor {
  readonly view: EditorView;
  setDoc(text: string): void;
  getDoc(): string;
  focus(): void;
}

export function createEditor(parent: HTMLElement, onChange: (doc: string) => void): NoteEditor {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    search({ top: true }),
    highlightSelectionMatches(),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(codeHighlight),
    livePreview,
    placeholder('Die erste Zeile wird der Titel …'),
    fioriTheme,
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
      'aria-label': 'Notizinhalt',
      'aria-describedby': 'editor-help',
      spellcheck: 'true',
      lang: 'de',
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];

  // `root: document` is required: CodeMirror follows `assignedSlot` to find
  // its root, which for content slotted into a UI5 component is that
  // component's shadow root. Focus is then never detected and the DOM
  // selection is not kept in sync (characters land in the wrong place).
  const view = new EditorView({ parent, root: document, state: EditorState.create({ doc: '', extensions }) });

  return {
    view,
    // Fresh state per note: separate undo history, no onChange call.
    setDoc(text) {
      view.setState(EditorState.create({ doc: text, extensions }));
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
  };
}

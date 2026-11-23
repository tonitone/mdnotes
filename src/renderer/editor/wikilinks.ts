import { autocompletion, closeCompletion, pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState, Facet, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { t } from '../../shared/i18n';
import { findWikiLinks, formatWikiLink } from '../../shared/wikilinks';

/**
 * Links between notes. `[[` opens a list of notes; the chosen note becomes
 * `[[<id>|<title>]]`. Outside the cursor the link shows the current title of
 * the target, so renaming a note never breaks a link. Ctrl/Cmd+Enter or a
 * click opens the target.
 */

export interface LinkTarget {
  id: string;
  title: string;
}

export interface LinkHandlers {
  /** All notes a link can point to. */
  targets: () => LinkTarget[];
  /** Opens a note by ID. */
  open: (id: string) => void;
}

export const linkHandlers = Facet.define<LinkHandlers, LinkHandlers>({
  combine: (values) => values[0] ?? { targets: () => [], open: () => undefined },
});

/** Lower case without accents, so "ubung" finds "Übung". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function complete(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n|]*/);
  if (!match) return null;
  const query = fold(match.text.slice(2)).trim();
  const { targets } = context.state.facet(linkHandlers);
  const options = targets()
    .filter((target) => target.title.trim() !== '' && fold(target.title).includes(query))
    .sort((a, b) => {
      const as = fold(a.title).startsWith(query) ? 0 : 1;
      const bs = fold(b.title).startsWith(query) ? 0 : 1;
      return as - bs || a.title.localeCompare(b.title);
    })
    .slice(0, 50)
    .map((target): Completion => ({
      label: target.title,
      apply: (view: EditorView, completion: Completion, from: number, to: number) => {
        // Swallow a `]]` the user (or an earlier edit) already left behind the cursor.
        const after = view.state.doc.sliceString(to, to + 2);
        const end = after === ']]' ? to + 2 : to;
        const insert = formatWikiLink(target.id, target.title);
        view.dispatch({
          changes: { from, to: end, insert },
          selection: { anchor: from + insert.length },
          userEvent: 'input.complete',
          annotations: pickedCompletion.of(completion),
        });
        // The list must not stay open behind the inserted link.
        closeCompletion(view);
      },
    }));
  return { from: match.from, options, filter: false };
}

class LinkWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly missing: boolean,
  ) {
    super();
  }
  eq(other: LinkWidget): boolean {
    return other.id === this.id && other.title === this.title && other.missing === this.missing;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('a');
    el.className = this.missing ? 'cm-note-link cm-note-link-missing' : 'cm-note-link';
    el.textContent = this.title;
    el.setAttribute('role', 'link');
    if (this.missing) el.title = t('link.missing');
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (!this.missing) view.state.facet(linkHandlers).open(this.id);
    });
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { targets } = state.facet(linkHandlers);
  const titles = new Map(targets().map((target) => [target.id, target.title]));
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const start = state.doc.lineAt(from).from;
    const end = state.doc.lineAt(to).to;
    for (const link of findWikiLinks(state.doc.sliceString(start, end))) {
      const a = start + link.from;
      const b = start + link.to;
      // The raw text stays visible while the cursor or a selection touches the link.
      if (state.selection.ranges.some((r) => r.from <= b && r.to >= a)) continue;
      const known = titles.get(link.id);
      const title = known ?? (link.alias || link.id);
      ranges.push(Decoration.replace({ widget: new LinkWidget(link.id, title, known === undefined) }).range(a, b));
    }
  }
  return Decoration.set(ranges, true);
}

/** Shows links as their target's title (live preview only). */
export const linkPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Opens the link at the cursor. */
function openLinkAtCursor(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const link = findWikiLinks(line.text).find((l) => line.from + l.from <= pos && pos <= line.from + l.to);
  if (!link) return false;
  const { open, targets } = view.state.facet(linkHandlers);
  if (!targets().some((target) => target.id === link.id)) return false;
  open(link.id);
  return true;
}

const theme = EditorView.theme({
  '.cm-note-link': {
    color: 'var(--sapLinkColor)',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  '.cm-note-link-missing': {
    color: 'var(--sapContent_LabelColor)',
    textDecoration: 'line-through',
    cursor: 'default',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--sapList_Background)',
    border: '1px solid var(--sapGroup_ContentBorderColor)',
    borderRadius: 'var(--sapElement_BorderCornerRadius)',
    boxShadow: 'var(--sapContent_Shadow1)',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--sapFontFamily)', maxHeight: '14rem' },
  '.cm-tooltip-autocomplete > ul > li': {
    color: 'var(--sapList_TextColor)',
    padding: '0.375rem 0.75rem',
    minHeight: '1.5rem',
    boxSizing: 'border-box',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--sapList_SelectionBackgroundColor)',
    color: 'var(--sapList_TextColor)',
  },
});

/** Link suggestions and keyboard access. The rendered links are `linkPreview`. */
export function noteLinks(handlers: LinkHandlers): Extension {
  return [
    linkHandlers.of(handlers),
    EditorState.phrases.of({
      Completions: t('link.completions'),
    }),
    autocompletion({ override: [complete], icons: false, activateOnTyping: true, closeOnBlur: true }),
    keymap.of([{ key: 'Mod-Enter', run: openLinkAtCursor }]),
    theme,
  ];
}

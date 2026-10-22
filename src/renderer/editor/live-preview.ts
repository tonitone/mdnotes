import { syntaxTree } from '@codemirror/language';
import { Facet, StateField, type EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { t } from '../../shared/i18n';
import { markdownToHtml } from '../../shared/markdown/html';

/**
 * Live preview: Markdown is rendered directly in the editor. On lines that
 * hold the cursor or a selection, the Markdown characters stay visible so
 * they can be edited (and read by screen readers). The file itself stays
 * plain Markdown.
 */

/** Maps an image `src` to a URL the editor may load, or null. */
export const assetResolver = Facet.define<(src: string) => string | null, (src: string) => string | null>({
  combine: (values) => values[0] ?? (() => null),
});

/** Lets the app announce short messages (e.g. "Code copied") to screen readers. */
function announce(from: HTMLElement, message: string): void {
  from.dispatchEvent(new CustomEvent('mdnotes-announce', { bubbles: true, detail: message }));
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string | null,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    if (!this.url) {
      const span = document.createElement('span');
      span.className = 'cm-md-image-missing';
      span.textContent = this.alt ? t('image.label', { alt: this.alt }) : t('image.missing');
      return span;
    }
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.src = this.url;
    img.alt = this.alt;
    img.draggable = false;
    // Image height is only known after loading; let CodeMirror re-measure.
    img.addEventListener('load', () => view.requestMeasure());
    return img;
  }
}

const CODE_LANGUAGES: Array<[string, string]> = [
  ['bash', 'Bash'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['python', 'Python'],
  ['sql', 'SQL'],
  ['typescript', 'TypeScript'],
  ['xml', 'XML'],
  ['yaml', 'YAML'],
];

/** Language picker and copy button at the end of a code block's opening fence. */
class CodeToolsWidget extends WidgetType {
  constructor(
    readonly lang: string,
    /** Where the language (info string) is, or an empty range right after the fence. */
    readonly infoFrom: number,
    readonly infoTo: number,
    readonly code: string,
  ) {
    super();
  }
  eq(other: CodeToolsWidget): boolean {
    return other.lang === this.lang && other.infoFrom === this.infoFrom && other.infoTo === this.infoTo && other.code === this.code;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-codetools';

    const select = document.createElement('select');
    select.setAttribute('aria-label', t('code.language'));
    const known: Array<[string, string]> = [['', t('code.noLanguage')], ...CODE_LANGUAGES];
    const options = known.some(([v]) => v === this.lang) ? known : [...known, [this.lang, this.lang]];
    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === this.lang;
      select.append(option);
    }
    select.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: select.value } });
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cm-md-copy';
    copy.textContent = t('code.copy');
    copy.setAttribute('aria-label', t('code.copyLabel'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.code);
        announce(copy, t('code.copied'));
      } catch {
        announce(copy, t('code.copyFailed'));
      }
    });

    wrap.append(select, copy);
    return wrap;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const hidden = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? t('task.done') : t('task.open'));
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** Line numbers that hold the cursor or a selection. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** The range plus one directly following space. */
function withSpace(state: EditorState, from: number, to: number): [number, number] {
  return state.doc.sliceString(to, to + 1) === ' ' ? [from, to + 1] : [from, to];
}

function eachLine(state: EditorState, from: number, to: number, fn: (lineFrom: number, first: boolean, last: boolean) => void): void {
  const start = state.doc.lineAt(from);
  const end = state.doc.lineAt(to);
  for (let n = start.number; n <= end.number; n++) {
    fn(state.doc.line(n).from, n === start.number, n === end.number);
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          ranges.push(line(`cm-md-h${heading[1]}`).range(state.doc.lineAt(node.from).from));
          return;
        }

        switch (name) {
          case 'HeaderMark': {
            if (isActive(node.from)) break;
            const lineStart = state.doc.lineAt(node.from).from;
            if (node.from === lineStart || state.doc.sliceString(lineStart, node.from).trim() === '') {
              const [a, b] = withSpace(state, node.from, node.to);
              ranges.push(hidden.range(a, b));
            } else if (node.to > node.from) {
              ranges.push(hidden.range(node.from, node.to)); // closing #
            }
            break;
          }
          case 'Emphasis':
            ranges.push(mark('cm-md-em').range(node.from, node.to));
            break;
          case 'StrongEmphasis':
            ranges.push(mark('cm-md-strong').range(node.from, node.to));
            break;
          case 'Strikethrough':
            ranges.push(mark('cm-md-strike').range(node.from, node.to));
            break;
          case 'InlineCode':
            ranges.push(mark('cm-md-code').range(node.from, node.to));
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) ranges.push(hidden.range(node.from, node.to));
            break;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) {
              ranges.push(hidden.range(node.from, node.to));
            }
            break;
          case 'Link': {
            const marks = node.node.getChildren('LinkMark');
            if (marks.length < 2) break;
            const textFrom = marks[0].to;
            const textTo = marks[1].from;
            if (textTo > textFrom) ranges.push(mark('cm-md-link').range(textFrom, textTo));
            if (!isActive(node.from)) {
              ranges.push(hidden.range(marks[0].from, marks[0].to));
              ranges.push(hidden.range(marks[1].from, node.to));
            }
            break;
          }
          case 'FencedCode': {
            const first = state.doc.lineAt(node.from);
            const last = state.doc.lineAt(node.to);
            if (!isActive(node.from) && !state.readOnly) {
              const info = node.node.getChild('CodeInfo');
              const fence = node.node.getChild('CodeMark');
              const closed = last.number > first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text);
              const codeFrom = Math.min(first.to + 1, node.to);
              const codeTo = closed ? Math.max(codeFrom, last.from - 1) : node.to;
              const lang = info ? state.doc.sliceString(info.from, info.to) : '';
              const infoFrom = info?.from ?? fence?.to ?? first.from + 3;
              const widget = new CodeToolsWidget(lang, infoFrom, info?.to ?? infoFrom, state.doc.sliceString(codeFrom, codeTo));
              ranges.push(Decoration.widget({ widget, side: 1 }).range(first.to));
            }
            eachLine(state, node.from, node.to, (lineFrom, first, last) => {
              const cls = ['cm-md-codeblock', first ? 'cm-md-codeblock-first' : '', last ? 'cm-md-codeblock-last' : '']
                .filter(Boolean)
                .join(' ');
              ranges.push(line(cls).range(lineFrom));
            });
            break;
          }
          case 'Blockquote':
            eachLine(state, node.from, node.to, (lineFrom) => ranges.push(line('cm-md-quote').range(lineFrom)));
            break;
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const [a, b] = withSpace(state, node.from, node.to);
              ranges.push(hidden.range(a, b));
            }
            break;
          case 'ListMark': {
            if (isActive(node.from)) break;
            const item = node.node.parent;
            const hasTask = item?.getChild('Task') != null;
            const inBulletList = item?.parent?.name === 'BulletList';
            if (hasTask) {
              const [a, b] = withSpace(state, node.from, node.to);
              ranges.push(hidden.range(a, b));
            } else if (inBulletList) {
              ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            }
            break;
          }
          case 'TaskMarker': {
            if (isActive(node.from)) break;
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            ranges.push(Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(node.from, node.to));
            if (checked) {
              const end = state.doc.lineAt(node.from).to;
              if (end > node.to) ranges.push(mark('cm-md-done').range(node.to, end));
            }
            break;
          }
          case 'Image': {
            if (isActive(node.from)) break;
            const marks = node.node.getChildren('LinkMark');
            const urlNode = node.node.getChild('URL');
            if (marks.length < 2 || !urlNode) break;
            const alt = state.doc.sliceString(marks[0].to, marks[1].from);
            const src = state.doc.sliceString(urlNode.from, urlNode.to);
            const url = state.facet(assetResolver)(src);
            ranges.push(Decoration.replace({ widget: new ImageWidget(url, alt) }).range(node.from, node.to));
            return false;
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) {
              ranges.push(line('cm-md-hr').range(state.doc.lineAt(node.from).from));
              ranges.push(hidden.range(node.from, node.to));
            }
            break;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

// ---------------------------------------------------------------------------
// Tables: outside the cursor, a GFM table is shown as a real table. Replacing
// several lines needs a block decoration, which CodeMirror only accepts from
// a state field, not from a view plugin.
// ---------------------------------------------------------------------------

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly resolve: (src: string) => string | null,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table';
    // Safe: the renderer escapes all text and only emits known tags.
    wrap.innerHTML = markdownToHtml(this.source, { resolveImage: (src) => this.resolve(src) ?? src });
    return wrap;
  }
  /** Let clicks through: CodeMirror places the cursor, which reveals the source. */
  ignoreEvent(): boolean {
    return false;
  }
}

function tableDecorations(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const resolve = state.facet(assetResolver);
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      let editing = false;
      for (let n = first.number; n <= last.number && !editing; n++) editing = active.has(n);
      if (!editing) {
        const widget = new TableWidget(state.doc.sliceString(first.from, last.to), resolve);
        ranges.push(Decoration.replace({ widget, block: true }).range(first.from, last.to));
      }
      return false;
    },
  });
  return Decoration.set(ranges, true);
}

export const tablePreview = StateField.define<DecorationSet>({
  create: tableDecorations,
  update(decorations, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return tableDecorations(tr.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

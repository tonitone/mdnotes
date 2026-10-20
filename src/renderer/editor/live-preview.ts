import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Live preview: Markdown is rendered directly in the editor. On lines that
 * hold the cursor or a selection, the Markdown characters stay visible so
 * they can be edited (and read by screen readers). The file itself stays
 * plain Markdown.
 */

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
    box.setAttribute('aria-label', this.checked ? 'Aufgabe erledigt' : 'Aufgabe offen');
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
          case 'FencedCode':
            eachLine(state, node.from, node.to, (lineFrom, first, last) => {
              const cls = ['cm-md-codeblock', first ? 'cm-md-codeblock-first' : '', last ? 'cm-md-codeblock-last' : '']
                .filter(Boolean)
                .join(' ');
              ranges.push(line(cls).range(lineFrom));
            });
            break;
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

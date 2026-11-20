import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { t } from '../../shared/i18n';
import { findBlockMath, findFootnoteMarks, findInlineMath } from '../../shared/markdown/math';
import { releaseSheets } from './csp-dom';
import { renderDiagram } from './diagram-render';
import { fenceDetails } from './live-preview';
import { renderMath } from './math-render';

/**
 * Math (`$x$`, `$$ ... $$`), Mermaid diagrams (```mermaid) and footnote
 * marks in the live preview. Like tables, widgets replace the source while
 * the cursor is elsewhere; clicking one puts the cursor in it and shows the
 * source again.
 */

/** True if `pos` lies in a code block or inline code, where `$` and `[^` are literal. */
function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return true;
  }
  return false;
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

class MathWidget extends WidgetType {
  private sheets: CSSStyleSheet[] = [];
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-md-math cm-md-math-block' : 'cm-md-math';
    // Until KaTeX is loaded the source is shown, so nothing jumps or disappears.
    el.textContent = this.tex;
    void renderMath(this.tex, this.display)
      .then((result) => {
        if (!result) return;
        this.sheets = result.sheets;
        el.replaceChildren(result.node);
        view.requestMeasure();
      })
      .catch(() => {
        el.classList.add('cm-md-math-error');
        el.title = t('math.error');
      });
    return el;
  }
  destroy(): void {
    releaseSheets(this.sheets);
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function mathDecorations(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  const lines = Array.from({ length: state.doc.lines }, (_, i) => state.doc.line(i + 1).text);
  const blockLines = new Set<number>();

  for (const block of findBlockMath(lines)) {
    const first = state.doc.line(block.start + 1);
    const last = state.doc.line(block.end + 1);
    if (inCode(state, first.from)) continue;
    for (let n = block.start + 1; n <= block.end + 1; n++) blockLines.add(n);
    let editing = false;
    for (let n = block.start + 1; n <= block.end + 1 && !editing; n++) editing = active.has(n);
    if (!editing) {
      ranges.push(Decoration.replace({ widget: new MathWidget(block.tex, true), block: true }).range(first.from, last.to));
    }
  }

  for (let n = 1; n <= state.doc.lines; n++) {
    if (blockLines.has(n) || active.has(n)) continue;
    const line = state.doc.line(n);
    if (!line.text.includes('$')) continue;
    for (const m of findInlineMath(line.text)) {
      if (inCode(state, line.from + m.from)) continue;
      ranges.push(Decoration.replace({ widget: new MathWidget(m.tex, false) }).range(line.from + m.from, line.from + m.to));
    }
  }
  return Decoration.set(ranges, true);
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

class DiagramWidget extends WidgetType {
  private sheets: CSSStyleSheet[] = [];
  constructor(
    readonly source: string,
    /** UI5 theme at build time; Mermaid colours depend on it. */
    readonly theme: string,
  ) {
    super();
  }
  eq(other: DiagramWidget): boolean {
    return other.source === this.source && other.theme === this.theme;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-md-diagram';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('diagram.label'));
    el.textContent = t('diagram.loading');
    renderDiagram(this.source)
      .then((result) => {
        this.sheets = result.sheets;
        el.replaceChildren(result.node);
        view.requestMeasure();
      })
      .catch(() => {
        // Invalid diagram code: say so and keep the source readable.
        el.classList.add('cm-md-diagram-error');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
        const message = document.createElement('p');
        message.textContent = t('diagram.error');
        const code = document.createElement('pre');
        code.textContent = this.source;
        el.replaceChildren(message, code);
        view.requestMeasure();
      });
    return el;
  }
  destroy(): void {
    releaseSheets(this.sheets);
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function currentTheme(): string {
  return document.documentElement.dataset.theme ?? '';
}

function diagramDecorations(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const theme = currentTheme();
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return;
      const details = fenceDetails(state, node.node);
      if (details.lang.toLowerCase() !== 'mermaid' || !details.code.trim()) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      // An unclosed fence is still being typed.
      if (last.number === first.number || !/^\s*(`{3,}|~{3,})\s*$/.test(last.text)) return false;
      for (let n = first.number; n <= last.number; n++) if (active.has(n)) return false;
      ranges.push(Decoration.replace({ widget: new DiagramWidget(details.code, theme), block: true }).range(first.from, last.to));
      return false;
    },
  });
  return Decoration.set(ranges, true);
}

/** Dispatched when the UI5 theme changes, so diagrams are drawn again in matching colours. */
const themeChanged = StateEffect.define<null>();

const themeWatcher = ViewPlugin.fromClass(
  class {
    private readonly observer: MutationObserver;
    constructor(view: EditorView) {
      this.observer = new MutationObserver(() => view.dispatch({ effects: themeChanged.of(null) }));
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    destroy() {
      this.observer.disconnect();
    }
  },
);

/** Block decorations must come from a state field, not from a view plugin. */
function replaceField(build: (state: EditorState) => DecorationSet): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: build,
    update(decorations, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(themeChanged))) {
        return build(tr.state);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export const mathPreview = replaceField(mathDecorations);
export const diagramPreview: Extension = [replaceField(diagramDecorations), themeWatcher];

// ---------------------------------------------------------------------------
// Footnote marks (source stays visible; only styled)
// ---------------------------------------------------------------------------

const refMark = Decoration.mark({ class: 'cm-md-footnote-ref' });
const defMark = Decoration.mark({ class: 'cm-md-footnote-def' });

function footnoteDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (line.text.includes('[^')) {
        for (const m of findFootnoteMarks(line.text)) {
          if (inCode(state, line.from + m.from)) continue;
          ranges.push((m.definition ? defMark : refMark).range(line.from + m.from, line.from + m.to));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export const footnotePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = footnoteDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = footnoteDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

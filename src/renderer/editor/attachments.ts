import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, WidgetType, keymap } from '@codemirror/view';
import { attachmentNameFromPath } from '../../shared/assets';
import { t } from '../../shared/i18n';

/**
 * Attachments: links to files in `assets/` that are not images, written as
 * `[report.pdf](assets/0123456789abcdef.pdf)`. The live preview shows them as
 * a chip (live-preview.ts). A click, or Ctrl/Cmd+Enter in the line, opens the
 * file with the system's app; the folder button, or Ctrl/Cmd+Shift+Enter, shows
 * it in the file manager.
 */

export interface AttachmentHandlers {
  open: (src: string) => void;
  reveal: (src: string) => void;
}

export const attachmentHandlers = Facet.define<AttachmentHandlers, AttachmentHandlers>({
  combine: (values) => values[0] ?? { open: () => undefined, reveal: () => undefined },
});

export class AttachmentWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly src: string,
  ) {
    super();
  }
  eq(other: AttachmentWidget): boolean {
    return other.name === this.name && other.src === this.src;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-attachment';
    // UI5 compact density for this subtree (set on a container, UI5 itself stays untouched).
    wrap.classList.add('ui5-content-density-compact');
    wrap.setAttribute('data-ui5-compact-size', '');

    const link = document.createElement('a');
    link.className = 'cm-attachment-link';
    link.setAttribute('role', 'link');
    link.title = t('attachment.open');
    const icon = document.createElement('ui5-icon');
    icon.setAttribute('name', 'attachment');
    icon.setAttribute('mode', 'Decorative');
    icon.className = 'cm-attachment-icon';
    const text = document.createElement('span');
    text.textContent = this.name;
    link.append(icon, text);
    link.addEventListener('mousedown', (event) => event.preventDefault());
    link.addEventListener('click', (event) => {
      event.preventDefault();
      view.state.facet(attachmentHandlers).open(this.src);
    });

    // UI5 button (registered in main.ts). The widget ignores all editor events.
    const reveal = document.createElement('ui5-button');
    reveal.setAttribute('icon', 'open-folder');
    reveal.setAttribute('design', 'Transparent');
    reveal.setAttribute('tooltip', t('attachment.reveal'));
    reveal.setAttribute('accessible-name', t('attachment.revealNamed', { name: this.name }));
    reveal.addEventListener('click', () => view.state.facet(attachmentHandlers).reveal(this.src));

    wrap.append(link, reveal);
    return wrap;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/** The attachment link (`[text](assets/…)`, not an image) under `pos`, if any. */
export function attachmentAt(state: EditorState, pos: number): { src: string } | null {
  const line = state.doc.lineAt(pos);
  let found: { src: string } | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (found) return false;
      if (node.name !== 'Link' || node.from > pos || node.to < pos) return;
      const url = node.node.getChild('URL');
      const src = url ? state.sliceDoc(url.from, url.to) : '';
      if (attachmentNameFromPath(src)) found = { src };
      return false;
    },
  });
  return found;
}

function runAtCursor(action: keyof AttachmentHandlers) {
  return (view: EditorView): boolean => {
    const hit = attachmentAt(view.state, view.state.selection.main.head);
    if (!hit) return false;
    view.state.facet(attachmentHandlers)[action](hit.src);
    return true;
  };
}

const theme = EditorView.theme({
  '.cm-attachment': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.125rem',
    verticalAlign: 'middle',
    maxWidth: '100%',
  },
  '.cm-attachment-link': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    minHeight: '1.5rem',
    color: 'var(--sapLinkColor)',
    textDecoration: 'underline',
    cursor: 'pointer',
    overflowWrap: 'anywhere',
  },
  '.cm-attachment-icon': { color: 'var(--sapContent_IconColor)' },
});

/** Opening and revealing attachments from the keyboard. The chip itself is part of the live preview. */
export function attachments(handlers: AttachmentHandlers): Extension {
  return [
    attachmentHandlers.of(handlers),
    keymap.of([
      { key: 'Mod-Enter', run: runAtCursor('open') },
      { key: 'Shift-Mod-Enter', run: runAtCursor('reveal') },
    ]),
    theme,
  ];
}

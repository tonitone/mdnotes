import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteDoc, NotesApi, VersionSummary } from '../shared/api';
import { el, type Ui5Element } from './ui';
import { t, tp } from '../shared/i18n';
import { formatVersionTime } from './format';
import { cspNonce } from './editor/csp';

/**
 * Version dialog: a timeline of versions on the left, a side-by-side diff of
 * the selected version against the current text on the right. Between the
 * two sides, each changed block has a button that takes the block from the
 * version into a working copy of the current text. Blocks can come from
 * several versions; nothing is saved before "Save taken blocks".
 */

/** What the dialog saved. */
export interface VersionDialogResult {
  doc: NoteDoc;
  /** True if only blocks were taken, false if a whole version was restored. */
  blocks: boolean;
}

function readOnlyEditor(label: string): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    cspNonce(),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.theme({
      '&': { fontFamily: 'var(--sapContent_MonospaceFontFamily, monospace)', fontSize: 'var(--sapFontSize)' },
      '.cm-content': { padding: '0.5rem 0.75rem' },
    }),
  ];
}

/** Counts changed lines on both sides of a merge view. */
function summarize(view: MergeView): string {
  const a = view.a.state.doc;
  const b = view.b.state.doc;
  let removed = 0;
  let added = 0;
  for (const chunk of view.chunks) {
    if (chunk.toA > chunk.fromA) removed += a.lineAt(Math.max(chunk.fromA, chunk.toA - 1)).number - a.lineAt(chunk.fromA).number + 1;
    if (chunk.toB > chunk.fromB) added += b.lineAt(Math.max(chunk.fromB, chunk.toB - 1)).number - b.lineAt(chunk.fromB).number + 1;
  }
  if (view.chunks.length === 0) return t('versions.identical');
  return t('versions.summary', {
    changes: tp('versions.changes', view.chunks.length),
    removed: tp('versions.lines', removed),
    added: tp('versions.lines', added),
  });
}

/**
 * Takes one changed block from the version (side A) into the working copy
 * (side B). Same range handling as the built-in revert of @codemirror/merge.
 */
function takeChunk(view: MergeView, index: number): boolean {
  const chunk = view.chunks[index];
  if (!chunk) return false;
  const source = view.a.state;
  const dest = view.b;
  let insert = source.sliceDoc(chunk.fromA, Math.max(chunk.fromA, chunk.toA - 1));
  if (chunk.fromA !== chunk.toA && chunk.toB <= dest.state.doc.length) insert += source.lineBreak;
  dest.dispatch({ changes: { from: chunk.fromB, to: Math.min(dest.state.doc.length, chunk.toB), insert }, userEvent: 'revert' });
  return true;
}

/** Wrappers of the take buttons; the merge view tags each with `data-chunk`. */
function takeControls(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.versions-take')];
}

/** Names each take button after its block number, once the merge view has tagged it. */
function labelTakeControls(host: HTMLElement): void {
  for (const wrapper of takeControls(host)) {
    const button = wrapper.firstElementChild as Ui5Element | null;
    if (!button || wrapper.dataset.chunk === undefined) continue;
    const label = t('versions.takeBlock', { n: Number(wrapper.dataset.chunk) + 1 });
    if (button.accessibleName !== label) {
      button.accessibleName = label;
      button.tooltip = label;
    }
  }
}

export async function openVersionDialog(api: NotesApi, id: string, title: string, current: string): Promise<VersionDialogResult | null> {
  const versions = await api.listVersions(id);
  return new Promise((resolve) => {
    let result: VersionDialogResult | null = null;
    let merge: MergeView | null = null;
    let observer: MutationObserver | null = null;
    let selected: VersionSummary | null = null;
    let versionText = '';
    // The current text with the blocks taken so far.
    let working = current;

    const list = el('ui5-list', { accessibleName: t('versions.list'), noDataText: t('versions.none') });
    const summary = el('p', { className: 'versions-summary', 'attr:role': 'status', 'attr:aria-live': 'polite' });
    const diffHost = el('div', { className: 'versions-diff' });
    const apply = el('ui5-button', { design: 'Emphasized', disabled: true }, [t('versions.apply')]);
    const reset = el('ui5-button', { design: 'Transparent', disabled: true }, [t('versions.reset')]);
    const restore = el('ui5-button', { design: 'Default', disabled: true }, [t('versions.restore')]);
    const close = el('ui5-button', { design: 'Transparent' }, [t('dialog.close')]);

    const content = versions.length
      ? el('div', { className: 'versions-layout' }, [
          el('div', { className: 'versions-timeline' }, [list]),
          el('div', { className: 'versions-detail' }, [
            summary,
            el('div', { className: 'versions-columns', 'attr:aria-hidden': 'true' }, [
              el('span', {}, [t('versions.selected')]),
              el('span'),
              el('span', {}, [t('versions.current')]),
            ]),
            diffHost,
          ]),
        ])
      : el('p', { className: 'versions-empty' }, [
          t('versions.noneLong'),
        ]);

    const dialog = el('ui5-dialog', { headerText: t('versions.title', { title }), accessibleName: t('versions.accessibleName', { title }), stretch: true }, [
      content,
      el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, versions.length ? [apply, reset, restore, close] : [close]),
    ]);

    const refresh = () => {
      if (!merge) return;
      const pending = working !== current;
      summary.textContent = pending ? `${summarize(merge)} ${t('versions.pending')}` : summarize(merge);
      apply.disabled = !pending;
      reset.disabled = !pending;
      restore.disabled = versionText === current;
    };

    /** Moves the focus to the take button of block `index` (or the nearest one), else to `fallback`. */
    const focusTakeControl = (index: number, fallback: HTMLElement) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const controls = takeControls(diffHost);
          const next = controls.find((c) => Number(c.dataset.chunk) >= index) ?? controls.at(-1);
          ((next?.firstElementChild as HTMLElement | null) ?? fallback).focus();
        }),
      );
    };

    const renderTakeControl = (): HTMLElement => {
      const button = el('ui5-button', { design: 'Transparent', icon: 'arrow-right' });
      const wrapper = el('div', { className: 'versions-take' }, [button]);
      // The merge view's own handler only reacts to mousedown, not to the
      // keyboard. Keep it out and use `click`, which Enter and Space fire too.
      wrapper.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('click', () => {
        const index = Number(wrapper.dataset.chunk);
        if (!merge || !takeChunk(merge, index)) return;
        working = merge.b.state.doc.toString();
        refresh();
        // The block's button disappears; the next block takes its number.
        focusTakeControl(index, apply);
      });
      return wrapper;
    };

    const show = async (version: VersionSummary) => {
      selected = version;
      for (const item of list.children as HTMLCollectionOf<Ui5Element>) item.navigated = item.dataset.name === version.name;
      versionText = await api.readVersion(id, version.name);
      observer?.disconnect();
      merge?.destroy();
      merge = new MergeView({
        a: { doc: versionText, extensions: readOnlyEditor(t('versions.versionOf', { time: formatVersionTime(version.time) })) },
        b: { doc: working, extensions: readOnlyEditor(t('versions.current')) },
        parent: diffHost,
        root: document,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
        revertControls: 'a-to-b',
        renderRevertControl: renderTakeControl,
      });
      // The merge view renders take buttons lazily (only for visible blocks).
      observer = new MutationObserver(() => labelTakeControls(diffHost));
      observer.observe(merge.dom.querySelector('.cm-merge-revert') ?? merge.dom, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-chunk'],
      });
      labelTakeControls(diffHost);
      refresh();
    };

    list.append(
      ...versions.map((v, index) =>
        el('ui5-li', { icon: 'history', description: index === 0 ? t('versions.newest') : '', 'data-name': v.name }, [formatVersionTime(v.time)]),
      ),
    );
    list.addEventListener('item-click', (event: Event) => {
      const name = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.name;
      const version = versions.find((v) => v.name === name);
      if (version) void show(version);
    });

    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        result = { doc: await api.restoreBlocks(id, working), blocks: true };
        dialog.open = false;
      } catch (err) {
        summary.textContent = t('versions.applyFailed');
        console.error(err);
        apply.disabled = false;
      }
    });
    reset.addEventListener('click', () => {
      working = current;
      if (selected) void show(selected).then(() => focusTakeControl(0, close));
    });
    restore.addEventListener('click', async () => {
      if (!selected) return;
      restore.disabled = true;
      try {
        result = { doc: await api.restoreVersion(id, selected.name), blocks: false };
        dialog.open = false;
      } catch (err) {
        summary.textContent = t('versions.restoreFailed');
        console.error(err);
        restore.disabled = false;
      }
    });
    close.addEventListener('click', () => (dialog.open = false));
    dialog.addEventListener('close', () => {
      observer?.disconnect();
      merge?.destroy();
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.open = true;

    // Preselect the newest version that differs from the current text.
    void (async () => {
      for (const v of versions.slice(0, 2)) {
        if ((await api.readVersion(id, v.name)) !== current || v === versions[Math.min(1, versions.length - 1)]) {
          await show(v);
          return;
        }
      }
    })();
  });
}

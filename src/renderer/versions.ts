import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteDoc, NotesApi, VersionSummary } from '../shared/api';
import { el, type Ui5Element } from './ui';
import { t, tp } from '../shared/i18n';
import { formatVersionTime } from './format';

/**
 * Version dialog: a timeline of versions on the left, a side-by-side diff of
 * the selected version against the current text on the right.
 */

function readOnlyEditor(label: string): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
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

export async function openVersionDialog(api: NotesApi, id: string, title: string, current: string): Promise<NoteDoc | null> {
  const versions = await api.listVersions(id);
  return new Promise((resolve) => {
    let result: NoteDoc | null = null;
    let merge: MergeView | null = null;
    let selected: VersionSummary | null = null;

    const list = el('ui5-list', { accessibleName: t('versions.list'), noDataText: t('versions.none') });
    const summary = el('p', { className: 'versions-summary', 'attr:role': 'status', 'attr:aria-live': 'polite' });
    const diffHost = el('div', { className: 'versions-diff' });
    const restore = el('ui5-button', { design: 'Emphasized', disabled: true }, [t('versions.restore')]);
    const close = el('ui5-button', { design: 'Transparent' }, [t('dialog.close')]);

    const content = versions.length
      ? el('div', { className: 'versions-layout' }, [
          el('div', { className: 'versions-timeline' }, [list]),
          el('div', { className: 'versions-detail' }, [
            summary,
            el('div', { className: 'versions-columns', 'attr:aria-hidden': 'true' }, [
              el('span', {}, [t('versions.selected')]),
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
      el('div', { className: 'dialog-footer', 'attr:slot': 'footer' }, versions.length ? [restore, close] : [close]),
    ]);

    const show = async (version: VersionSummary) => {
      selected = version;
      for (const item of list.children as HTMLCollectionOf<Ui5Element>) item.navigated = item.dataset.name === version.name;
      const text = await api.readVersion(id, version.name);
      merge?.destroy();
      merge = new MergeView({
        a: { doc: text, extensions: readOnlyEditor(t('versions.versionOf', { time: formatVersionTime(version.time) })) },
        b: { doc: current, extensions: readOnlyEditor(t('versions.current')) },
        parent: diffHost,
        root: document,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      });
      summary.textContent = summarize(merge);
      restore.disabled = text === current;
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

    restore.addEventListener('click', async () => {
      if (!selected) return;
      restore.disabled = true;
      try {
        result = await api.restoreVersion(id, selected.name);
        dialog.open = false;
      } catch (err) {
        summary.textContent = t('versions.restoreFailed');
        console.error(err);
        restore.disabled = false;
      }
    });
    close.addEventListener('click', () => (dialog.open = false));
    dialog.addEventListener('close', () => {
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

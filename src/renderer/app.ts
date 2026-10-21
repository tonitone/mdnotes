import type { ExportFormat, MenuCommand, NoteSummary, NotesApi, NotesChangedEvent, SaveResult, SearchHit, TrashEntry } from '../shared/api';
import { MAX_ASSET_BYTES, isImageMime } from '../shared/assets';
import { markdownToWiki } from '../shared/markdown/wiki';
import { createEditor, type NoteEditor } from './editor/editor';
import { THEME_LABELS, getDensity, getThemeChoice, setDensity, setThemeChoice, type ThemeChoice } from './theme';
import { announce, confirmDialog, el, infoDialog, promptDialog, type Ui5Element } from './ui';

/** Delay after the last keystroke before saving. */
const SAVE_DELAY_MS = 700;
/** Delay before renaming the file after its title. */
const FINALIZE_DELAY_MS = 4000;
const SEARCH_DELAY_MS = 150;

type View = { kind: 'all' } | { kind: 'trash' } | { kind: 'label'; label: string };

const $ = <T extends HTMLElement = Ui5Element>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: #${id}`);
  return node as T;
};

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function formatModified(ms: number): string {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateFormat.format(date);
}

function sameLabel(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export class App {
  private notes: NoteSummary[] = [];
  private trash: TrashEntry[] = [];
  private view: View = { kind: 'all' };
  private currentId: string | null = null;
  private currentTrash: string | null = null;
  private editor: NoteEditor | null = null;
  private dirty = false;
  /** An outside change is waiting for the user's decision; autosave is paused. */
  private conflict = false;
  private saveTimer: number | undefined;
  private finalizeTimer: number | undefined;
  private searchTimer: number | undefined;
  private saving: Promise<void> = Promise.resolve();
  private query = '';
  private searchHits: SearchHit[] | null = null;

  private readonly els = {
    fcl: $('fcl'),
    shell: $('shell'),
    themeItem: $('themeItem'),
    workspaceItem: $('workspaceItem'),
    themeMenu: $('themeMenu'),
    browserModeStrip: $('browserModeStrip'),
    workspacePath: $('workspacePath'),
    libraryList: $('libraryList'),
    allNotesItem: $('allNotesItem'),
    trashItem: $('trashItem'),
    labelList: $('labelList'),
    notesTitle: $('notesTitle'),
    notesList: $('notesList'),
    newNoteButton: $('newNoteButton'),
    moreButton: $('moreButton'),
    moreMenu: $('moreMenu'),
    searchInput: $('searchInput'),
    backButton: $('backButton'),
    fileName: $('fileName'),
    saveStatus: $('saveStatus'),
    noteActions: $('noteActions'),
    exportButton: $('exportButton'),
    exportMenu: $('exportMenu'),
    deleteButton: $('deleteButton'),
    trashActions: $('trashActions'),
    restoreButton: $('restoreButton'),
    deleteForeverButton: $('deleteForeverButton'),
    labelRow: $('labelRow'),
    labelInput: $('labelInput'),
    noticeRegion: $('noticeRegion'),
    errorRegion: $('errorRegion'),
    editorHost: $('editor-host'),
    noSelection: $('noSelection'),
    noWorkspace: $('noWorkspace'),
    chooseWorkspaceButton: $('chooseWorkspaceButton'),
  };

  constructor(private readonly api: NotesApi) {}

  async start(): Promise<void> {
    this.els.fcl.accessibilityAttributes = {
      startColumn: { role: 'navigation', name: 'Bibliothek' },
      midColumn: { role: 'region', name: 'Notizen' },
      endColumn: { role: 'main', name: 'Editor' },
    };
    // The title area is a link; its accessible name must contain the visible text.
    this.els.shell.accessibilityAttributes = { logo: { name: 'mdnotes' } };
    this.els.browserModeStrip.hidden = this.api.mode !== 'browser';
    this.editor = createEditor(this.els.editorHost, {
      onChange: () => this.onEditorChange(),
      resolveAsset: (src) => this.api.assetUrl(src),
      saveImages: (files) => this.saveImages(files),
      onImagesInserted: (inserted) => void this.askForAltTexts(inserted),
    });
    // Expose the editor to e2e tests in browser mode only.
    if (__BROWSER_MODE__) (window as unknown as { __editorView: unknown }).__editorView = this.editor.view;
    this.buildThemeMenu();
    this.bindEvents();

    const workspace = await this.api.getWorkspace();
    if (workspace) {
      await this.showWorkspace(workspace);
    } else {
      this.showView('noWorkspace');
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    const { els } = this;
    els.newNoteButton.addEventListener('click', () => void this.newNote());
    els.chooseWorkspaceButton.addEventListener('click', () => void this.chooseWorkspace());
    els.workspaceItem.addEventListener('click', () => void this.chooseWorkspace());

    els.themeItem.addEventListener('click', (event: Event) => {
      const detail = (event as CustomEvent<{ targetRef: HTMLElement }>).detail;
      event.preventDefault?.();
      els.themeMenu.opener = detail?.targetRef ?? els.themeItem;
      els.themeMenu.open = true;
    });
    els.themeMenu.addEventListener('item-click', (event: Event) => {
      const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
      const { theme, density } = item.dataset;
      if (theme) setThemeChoice(theme as ThemeChoice);
      if (density) setDensity(density as 'compact' | 'cozy');
      this.buildThemeMenu();
    });

    // Library: all notes, trash and labels.
    els.libraryList.addEventListener('item-click', (event: Event) => {
      const view = (event as CustomEvent<{ item: HTMLElement }>).detail.item?.dataset.view;
      if (view === 'all' || view === 'trash') void this.setView({ kind: view });
    });
    els.labelList.addEventListener('item-click', (event: Event) => {
      const label = (event as CustomEvent<{ item: HTMLElement }>).detail.item?.dataset.label;
      if (label) void this.setView({ kind: 'label', label });
    });

    // Fiori master-detail pattern: no selection mode (which renders invalid
    // aria-selected on role=listitem), the open note is marked as `navigated`.
    els.notesList.addEventListener('item-click', (event: Event) => {
      const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
      if (item?.dataset.id && item.dataset.id !== this.currentId) void this.openNote(item.dataset.id);
      if (item?.dataset.trash && item.dataset.trash !== this.currentTrash) void this.openTrashEntry(item.dataset.trash);
    });

    els.searchInput.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.runSearch(), SEARCH_DELAY_MS);
    });

    els.moreButton.addEventListener('click', () => {
      els.moreMenu.opener = els.moreButton;
      els.moreMenu.open = true;
    });
    els.moreMenu.addEventListener('item-click', (event: Event) => {
      const action = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.action;
      if (action === 'import') void this.importNotes();
      if (action === 'export-all') void this.exportAll();
    });

    els.exportButton.addEventListener('click', () => {
      els.exportMenu.opener = els.exportButton;
      els.exportMenu.open = true;
    });
    els.exportMenu.addEventListener('item-click', (event: Event) => {
      const { action, format } = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset;
      if (action === 'copy-wiki') void this.copyCurrent('wiki');
      if (action === 'copy-markdown') void this.copyCurrent('markdown');
      if (format) void this.exportCurrent(format as ExportFormat);
    });
    els.deleteButton.addEventListener('click', () => void this.trashCurrent());
    els.restoreButton.addEventListener('click', () => void this.restoreCurrentTrash());
    els.deleteForeverButton.addEventListener('click', () => void this.deleteCurrentTrashForever());

    els.labelInput.addEventListener('change', () => void this.addLabelFromInput());
    els.labelInput.addEventListener('input', () => this.updateLabelSuggestions());
    els.labelInput.addEventListener('token-delete', (event: Event) => {
      const tokens = (event as CustomEvent<{ tokens: Ui5Element[] }>).detail.tokens ?? [];
      const removed = tokens.map((t) => String(t.text));
      void this.updateLabels((labels) => labels.filter((l) => !removed.some((r) => sameLabel(r, l))));
    });

    els.backButton.addEventListener('click', () => {
      els.fcl.layout = 'TwoColumnsMidExpanded';
      (els.notesList.querySelector('[navigated]') as HTMLElement | null)?.focus();
    });
    els.fcl.addEventListener('layout-change', (event: Event) => {
      const detail = (event as CustomEvent<{ midColumnVisible: boolean }>).detail;
      els.backButton.hidden = detail.midColumnVisible;
    });

    els.editorHost.addEventListener('mdnotes-announce', (event: Event) => announce(String((event as CustomEvent).detail)));

    // Dropping Markdown files anywhere imports them. Images are handled by the editor.
    document.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      const files = [...(event.dataTransfer?.files ?? [])].filter((f) => /\.(md|markdown)$/i.test(f.name));
      event.preventDefault();
      if (files.length > 0) void this.importDropped(files);
    });

    this.api.onMenuCommand((command: MenuCommand) => {
      if (command === 'new-note') void this.newNote();
      if (command === 'choose-workspace') void this.chooseWorkspace();
      if (command === 'find') (els.searchInput as HTMLElement).focus();
      if (command === 'delete-note') void this.trashCurrent();
      if (command === 'import') void this.importNotes();
      if (command === 'export-all') void this.exportAll();
    });
    this.api.onFlushRequest(() => this.flush());
    this.api.onNotesChanged((event) => void this.onNotesChanged(event));
  }

  private buildThemeMenu(): void {
    const menu = this.els.themeMenu;
    menu.replaceChildren();
    const current = getThemeChoice();
    for (const [value, label] of Object.entries(THEME_LABELS)) {
      menu.append(el('ui5-menu-item', { 'attr:text': label, 'data-theme': value, icon: value === current ? 'accept' : '' }));
    }
    menu.append(el('ui5-menu-separator'));
    const density = getDensity();
    for (const [value, label] of [['compact', 'Kompakt'], ['cozy', 'Komfortabel']] as const) {
      menu.append(el('ui5-menu-item', { 'attr:text': label, 'data-density': value, icon: value === density ? 'accept' : '' }));
    }
  }

  // -------------------------------------------------------------------------
  // Workspace, library and list
  // -------------------------------------------------------------------------

  private async chooseWorkspace(): Promise<void> {
    await this.flush();
    try {
      const workspace = await this.api.chooseWorkspace();
      if (workspace) await this.showWorkspace(workspace);
    } catch (err) {
      this.showError('Der Ordner konnte nicht geöffnet werden.', err);
    }
  }

  private async showWorkspace(workspace: string): Promise<void> {
    this.els.workspacePath.textContent = workspace;
    this.els.workspacePath.title = workspace;
    for (const control of [this.els.newNoteButton, this.els.moreButton, this.els.searchInput]) control.disabled = false;
    this.closeEditor();
    this.notes = await this.api.listNotes();
    this.view = { kind: 'all' };
    this.renderLibrary();
    this.renderList();
  }

  private async setView(view: View): Promise<void> {
    await this.flush();
    this.view = view;
    this.closeEditor();
    if (view.kind === 'trash') this.trash = await this.api.listTrash();
    this.renderLibrary();
    await this.runSearch();
  }

  private renderLibrary(): void {
    const { view } = this;
    this.els.allNotesItem.navigated = view.kind === 'all';
    this.els.trashItem.navigated = view.kind === 'trash';

    const counts = new Map<string, { label: string; count: number }>();
    for (const note of this.notes) {
      for (const label of note.labels) {
        const key = label.toLocaleLowerCase();
        const entry = counts.get(key) ?? { label, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    const labels = [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
    this.els.labelList.replaceChildren(
      ...labels.map(({ label, count }) =>
        el('ui5-li', {
          icon: 'tag',
          additionalText: String(count),
          navigated: view.kind === 'label' && sameLabel(view.label, label),
          'data-label': label,
        }, [label]),
      ),
    );
    // A label filter whose last note lost the label falls back to all notes.
    if (view.kind === 'label' && !counts.has(view.label.toLocaleLowerCase())) {
      this.view = { kind: 'all' };
      this.els.allNotesItem.navigated = true;
    }

    this.els.notesTitle.textContent =
      this.view.kind === 'trash' ? 'Papierkorb' : this.view.kind === 'label' ? `Label: ${this.view.label}` : 'Notizen';
    this.els.newNoteButton.hidden = this.view.kind === 'trash';
  }

  private async runSearch(): Promise<void> {
    this.query = String(this.els.searchInput.value ?? '').trim();
    this.searchHits = this.query && this.view.kind !== 'trash' ? await this.api.searchNotes(this.query) : null;
    this.renderList();
  }

  private visibleNotes(): Array<NoteSummary & { snippet?: string }> {
    const { view } = this;
    const inView = (n: NoteSummary) => view.kind !== 'label' || n.labels.some((l) => sameLabel(l, view.label));
    if (!this.searchHits) return this.notes.filter(inView);
    const byId = new Map(this.notes.map((n) => [n.id, n]));
    return this.searchHits
      .map((hit) => ({ ...byId.get(hit.id)!, snippet: hit.snippet }))
      .filter((n) => n.id && inView(n));
  }

  private renderList(): void {
    const list = this.els.notesList;
    if (this.view.kind === 'trash') {
      const q = this.query.toLocaleLowerCase();
      const entries = this.trash.filter((t) => !q || `${t.title} ${t.preview}`.toLocaleLowerCase().includes(q));
      list.noDataText = q ? 'Keine Treffer' : 'Der Papierkorb ist leer';
      list.replaceChildren(
        ...entries.map((t) =>
          el('ui5-li', {
            icon: 'document-text',
            description: t.preview || 'Kein weiterer Text',
            additionalText: `Gelöscht ${formatModified(t.trashedAt)}`,
            navigated: t.trashName === this.currentTrash,
            'data-trash': t.trashName,
          }, [t.title]),
        ),
      );
      return;
    }
    list.noDataText = this.query ? 'Keine Treffer' : 'Noch keine Notizen';
    list.replaceChildren(
      ...this.visibleNotes().map((note) =>
        el('ui5-li', {
          icon: 'document-text',
          description: note.snippet ?? (note.preview || 'Kein weiterer Text'),
          additionalText: formatModified(note.modified),
          tooltip: note.fileName,
          navigated: note.id === this.currentId,
          'data-id': note.id,
        }, [note.title]),
      ),
    );
  }

  /** Marks the current note without rebuilding the list (keeps focus). */
  private updateSelection(): void {
    for (const item of this.els.notesList.children as HTMLCollectionOf<Ui5Element>) {
      item.navigated = item.dataset.id ? item.dataset.id === this.currentId : item.dataset.trash === this.currentTrash;
    }
  }

  /** Updates an entry after saving and moves it to the top. */
  private applySaveResult(result: SaveResult | NoteSummary): void {
    const index = this.notes.findIndex((n) => n.id === result.id);
    if (index === -1) return;
    const updated = { ...this.notes[index], ...result };
    this.notes.splice(index, 1);
    this.notes.unshift(updated);
    this.renderList();
    if (result.id === this.currentId) this.els.fileName.textContent = updated.fileName;
  }

  private showView(view: 'editor' | 'trashEntry' | 'noSelection' | 'noWorkspace'): void {
    const editing = view === 'editor' || view === 'trashEntry';
    this.els.editorHost.hidden = !editing;
    this.els.noSelection.hidden = view !== 'noSelection';
    this.els.noWorkspace.hidden = view !== 'noWorkspace';
    this.els.noteActions.hidden = view !== 'editor';
    this.els.labelRow.hidden = view !== 'editor';
    this.els.trashActions.hidden = view !== 'trashEntry';
    if (!editing) {
      this.els.fileName.textContent = '';
      this.els.saveStatus.textContent = '';
    }
  }

  private closeEditor(): void {
    this.currentId = null;
    this.currentTrash = null;
    this.conflict = false;
    this.els.noticeRegion.replaceChildren();
    this.showView('noSelection');
  }

  // -------------------------------------------------------------------------
  // Open, create and save notes
  // -------------------------------------------------------------------------

  private async openNote(id: string): Promise<void> {
    await this.flush();
    try {
      const doc = await this.api.readNote(id);
      this.closeEditor();
      this.currentId = id;
      this.editor?.setDoc(doc.body);
      this.els.fileName.textContent = doc.fileName;
      this.setStatus(`Zuletzt geändert ${formatModified(doc.modified)}`);
      this.renderTokens(doc.labels);
      this.showView('editor');
      this.els.fcl.layout = 'ThreeColumnsEndExpanded';
      this.updateSelection();
    } catch (err) {
      this.showError('Die Notiz konnte nicht geöffnet werden.', err);
    }
  }

  private async newNote(): Promise<void> {
    await this.flush();
    try {
      const doc = await this.api.createNote();
      this.notes.unshift(doc);
      this.els.searchInput.value = '';
      this.query = '';
      this.searchHits = null;
      if (this.view.kind !== 'all') {
        this.view = { kind: 'all' };
        this.renderLibrary();
      }
      this.closeEditor();
      this.currentId = doc.id;
      this.renderList();
      this.editor?.setDoc(doc.body);
      this.els.fileName.textContent = doc.fileName;
      this.setStatus('Neu angelegt');
      this.renderTokens([]);
      this.showView('editor');
      this.els.fcl.layout = 'ThreeColumnsEndExpanded';
      this.editor?.focus();
    } catch (err) {
      this.showError('Die Notiz konnte nicht angelegt werden.', err);
    }
  }

  private onEditorChange(): void {
    if (!this.currentId) return;
    this.dirty = true;
    if (this.conflict) return;
    this.setStatus('Nicht gespeichert');
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.finalizeTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), SAVE_DELAY_MS);
    this.finalizeTimer = window.setTimeout(() => {
      this.finalizeTimer = undefined;
      void this.finalize();
    }, FINALIZE_DELAY_MS);
  }

  private save(): Promise<void> {
    const id = this.currentId;
    if (!id || !this.dirty || !this.editor || this.conflict) return this.saving;
    const body = this.editor.getDoc();
    this.dirty = false;
    this.setStatus('Speichert …');
    this.saving = this.saving.then(async () => {
      try {
        const result = await this.api.saveNote(id, body);
        this.applySaveResult(result);
        if (id === this.currentId && !this.dirty) {
          this.setStatus(`Gespeichert um ${timeFormat.format(new Date(result.modified))}`);
        }
      } catch (err) {
        this.dirty = true;
        this.showError('Speichern fehlgeschlagen. Deine Änderungen sind noch im Editor.', err);
      }
    });
    return this.saving;
  }

  private async finalize(id = this.currentId): Promise<void> {
    if (!id || this.conflict) return;
    await this.save();
    try {
      this.applySaveResult(await this.api.finalizeNote(id));
    } catch (err) {
      this.showError('Die Datei konnte nicht umbenannt werden. Der Inhalt ist gespeichert.', err);
    }
  }

  /** Saves pending changes and updates the file name. */
  async flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const pendingFinalize = this.finalizeTimer !== undefined;
    window.clearTimeout(this.finalizeTimer);
    this.finalizeTimer = undefined;
    await this.save();
    if (pendingFinalize) await this.finalize();
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  private currentLabels(): string[] {
    return this.notes.find((n) => n.id === this.currentId)?.labels ?? [];
  }

  private renderTokens(labels: string[]): void {
    this.els.labelInput.replaceChildren(...labels.map((label) => el('ui5-token', { 'attr:slot': 'tokens', text: label })));
    this.els.labelInput.value = '';
  }

  private updateLabelSuggestions(): void {
    const value = String(this.els.labelInput.value ?? '').toLocaleLowerCase();
    const own = this.currentLabels();
    const all = new Map<string, string>();
    for (const note of this.notes) for (const l of note.labels) all.set(l.toLocaleLowerCase(), l);
    const suggestions = [...all.values()]
      .filter((l) => l.toLocaleLowerCase().includes(value) && !own.some((o) => sameLabel(o, l)))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20);
    for (const old of this.els.labelInput.querySelectorAll('ui5-suggestion-item')) old.remove();
    this.els.labelInput.append(...suggestions.map((text) => el('ui5-suggestion-item', { text })));
  }

  private async addLabelFromInput(): Promise<void> {
    const value = String(this.els.labelInput.value ?? '').trim();
    this.els.labelInput.value = '';
    if (!value) return;
    await this.updateLabels((labels) => [...labels, ...value.split(',')]);
  }

  private async updateLabels(change: (labels: string[]) => string[]): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    try {
      const summary = await this.api.setLabels(id, change(this.currentLabels()));
      const note = this.notes.find((n) => n.id === id);
      if (note) note.labels = summary.labels;
      if (id === this.currentId) this.renderTokens(summary.labels);
      this.renderLibrary();
      this.renderList();
    } catch (err) {
      this.showError('Die Labels konnten nicht gespeichert werden.', err);
    }
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  private async saveImages(files: File[]): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      if (!isImageMime(file.type)) {
        this.showError(`„${file.name}“ ist kein unterstütztes Bildformat (PNG, JPEG, GIF, WebP, SVG).`, file.type);
        continue;
      }
      if (file.size > MAX_ASSET_BYTES) {
        this.showError(`„${file.name}“ ist größer als 20 MB und wurde nicht eingefügt.`, file.size);
        continue;
      }
      try {
        paths.push(await this.api.saveAsset(new Uint8Array(await file.arrayBuffer()), file.type));
      } catch (err) {
        this.showError('Das Bild konnte nicht gespeichert werden.', err);
      }
    }
    return paths;
  }

  /** Asks for an alternative text right after inserting images (accessibility). */
  private async askForAltTexts(inserted: Array<{ from: number; path: string }>): Promise<void> {
    const view = this.editor?.view;
    if (!view) return;
    // Work from the last image backwards so earlier positions stay valid.
    for (const { from, path } of [...inserted].reverse()) {
      const alt = await promptDialog(
        'Bildbeschreibung',
        'Beschreibung',
        'Kurz beschreiben, was das Bild zeigt. Screenreader lesen diesen Text vor.',
      );
      const markup = `![](${path})`;
      if (alt && view.state.doc.sliceString(from, from + markup.length) === markup) {
        view.dispatch({ changes: { from: from + 2, insert: alt.replace(/[[\]\n]/g, ' ').trim() } });
      }
    }
    view.focus();
  }

  // -------------------------------------------------------------------------
  // Trash
  // -------------------------------------------------------------------------

  private async trashCurrent(): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    await this.flush();
    const title = this.notes.find((n) => n.id === id)?.title ?? 'Notiz';
    try {
      await this.api.trashNote(id);
      this.notes = this.notes.filter((n) => n.id !== id);
      this.closeEditor();
      this.renderLibrary();
      this.renderList();
      announce(`„${title}“ in den Papierkorb verschoben.`);
    } catch (err) {
      this.showError('Die Notiz konnte nicht in den Papierkorb verschoben werden.', err);
    }
  }

  private async openTrashEntry(trashName: string): Promise<void> {
    try {
      const body = await this.api.readTrash(trashName);
      const entry = this.trash.find((t) => t.trashName === trashName);
      this.closeEditor();
      this.currentTrash = trashName;
      this.editor?.setDoc(body, { readOnly: true });
      this.els.fileName.textContent = entry?.title ?? '';
      this.setStatus(entry ? `Gelöscht ${formatModified(entry.trashedAt)}` : '');
      this.showView('trashEntry');
      this.els.fcl.layout = 'ThreeColumnsEndExpanded';
      this.updateSelection();
    } catch (err) {
      this.showError('Die Notiz im Papierkorb konnte nicht geöffnet werden.', err);
    }
  }

  private async restoreCurrentTrash(): Promise<void> {
    const name = this.currentTrash;
    if (!name) return;
    try {
      const summary = await this.api.restoreFromTrash(name);
      this.notes = await this.api.listNotes();
      this.trash = await this.api.listTrash();
      this.closeEditor();
      this.renderLibrary();
      this.renderList();
      announce(`„${summary.title}“ wiederhergestellt.`);
    } catch (err) {
      this.showError('Die Notiz konnte nicht wiederhergestellt werden.', err);
    }
  }

  private async deleteCurrentTrashForever(): Promise<void> {
    const name = this.currentTrash;
    if (!name) return;
    const title = this.trash.find((t) => t.trashName === name)?.title ?? 'Notiz';
    const ok = await confirmDialog(
      'Endgültig löschen?',
      `„${title}“ wird dauerhaft gelöscht. Das lässt sich nicht rückgängig machen.`,
      'Endgültig löschen',
    );
    if (!ok) return;
    try {
      await this.api.deleteFromTrash(name);
      this.trash = this.trash.filter((t) => t.trashName !== name);
      this.closeEditor();
      this.renderList();
      announce(`„${title}“ endgültig gelöscht.`);
    } catch (err) {
      this.showError('Die Notiz konnte nicht gelöscht werden.', err);
    }
  }

  // -------------------------------------------------------------------------
  // Export and import
  // -------------------------------------------------------------------------

  private async copyCurrent(format: 'wiki' | 'markdown'): Promise<void> {
    if (!this.editor || !this.currentId) return;
    await this.flush();
    const body = this.editor.getDoc();
    try {
      await navigator.clipboard.writeText(format === 'wiki' ? markdownToWiki(body) : body);
      announce(format === 'wiki' ? 'Wiki-Markup kopiert.' : 'Markdown kopiert.');
    } catch (err) {
      this.showError('Kopieren in die Zwischenablage ist fehlgeschlagen.', err);
    }
  }

  private async exportCurrent(format: ExportFormat): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    await this.flush();
    try {
      const target = await this.api.exportNote(id, format);
      if (target) announce(`Exportiert: ${target}`);
    } catch (err) {
      this.showError('Der Export ist fehlgeschlagen.', err);
    }
  }

  private async exportAll(): Promise<void> {
    await this.flush();
    try {
      const folder = await this.api.exportAll();
      if (folder) announce(`Alle Notizen exportiert nach ${folder}`);
    } catch (err) {
      this.showError('Der Export ist fehlgeschlagen.', err);
    }
  }

  private async importNotes(): Promise<void> {
    await this.flush();
    try {
      const report = await this.api.importNotes();
      if (report) await this.showImportReport(report);
    } catch (err) {
      this.showError('Der Import ist fehlgeschlagen.', err);
    }
  }

  private async importDropped(files: File[]): Promise<void> {
    await this.flush();
    try {
      const report = await this.api.importTexts(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
      await this.showImportReport(report);
    } catch (err) {
      this.showError('Der Import ist fehlgeschlagen.', err);
    }
  }

  private async showImportReport(report: { imported: number; skipped: number; warnings: string[] }): Promise<void> {
    this.notes = await this.api.listNotes();
    this.renderLibrary();
    await this.runSearch();
    const summary = `${report.imported} importiert, ${report.skipped} übersprungen (bereits vorhanden).`;
    if (report.warnings.length === 0) {
      announce(summary);
    } else {
      await infoDialog('Import abgeschlossen', [summary, ...report.warnings]);
    }
  }

  // -------------------------------------------------------------------------
  // Outside changes (file watcher)
  // -------------------------------------------------------------------------

  private async onNotesChanged(event: NotesChangedEvent): Promise<void> {
    this.notes = await this.api.listNotes();
    this.renderLibrary();
    await this.runSearch();
    const id = this.currentId;
    if (!id) return;

    if (event.removed.includes(id)) {
      if (this.dirty) {
        this.showNotice('Critical', 'Die Datei dieser Notiz wurde außerhalb der App gelöscht. Deine Änderungen sind nur noch im Editor.', [
          { text: 'Als neue Notiz sichern', action: () => void this.saveAsNewNote() },
        ]);
        this.conflict = true;
      } else {
        this.closeEditor();
        announce('Die geöffnete Notiz wurde außerhalb der App gelöscht.');
      }
      return;
    }

    if (event.changed.includes(id)) {
      if (!this.dirty) {
        await this.reloadCurrent();
        this.showNotice('Information', 'Die Notiz wurde außerhalb der App geändert und neu geladen.');
      } else {
        this.conflict = true;
        window.clearTimeout(this.saveTimer);
        this.showNotice('Critical', 'Die Notiz wurde außerhalb der App geändert, während du sie bearbeitet hast.', [
          { text: 'Externe Version laden', action: () => void this.resolveConflict('theirs') },
          { text: 'Meine Version behalten', action: () => void this.resolveConflict('mine') },
        ]);
      }
    }
  }

  private async reloadCurrent(): Promise<void> {
    const id = this.currentId;
    const view = this.editor?.view;
    if (!id || !view) return;
    const doc = await this.api.readNote(id);
    const head = Math.min(view.state.selection.main.head, doc.body.length);
    this.editor!.setDoc(doc.body);
    view.dispatch({ selection: { anchor: head } });
    this.dirty = false;
    this.els.fileName.textContent = doc.fileName;
    this.renderTokens(doc.labels);
  }

  private async resolveConflict(choice: 'mine' | 'theirs'): Promise<void> {
    this.conflict = false;
    this.els.noticeRegion.replaceChildren();
    if (choice === 'theirs') {
      await this.reloadCurrent();
      announce('Externe Version geladen.');
    } else {
      this.dirty = true;
      await this.save();
      announce('Deine Version wurde gespeichert.');
    }
  }

  private async saveAsNewNote(): Promise<void> {
    const body = this.editor?.getDoc() ?? '';
    this.conflict = false;
    this.dirty = false;
    this.els.noticeRegion.replaceChildren();
    const doc = await this.api.createNote();
    await this.api.saveNote(doc.id, body);
    this.notes = await this.api.listNotes();
    this.renderLibrary();
    await this.openNote(doc.id);
    announce('Als neue Notiz gesichert.');
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  private setStatus(text: string): void {
    // Only set on a real change, otherwise screen readers announce it twice.
    if (this.els.saveStatus.textContent !== text) this.els.saveStatus.textContent = text;
  }

  private showNotice(design: 'Information' | 'Critical', text: string, actions: Array<{ text: string; action: () => void }> = []): void {
    const buttons = actions.map(({ text: label, action }) => {
      const button = el('ui5-button', { design: 'Transparent' }, [label]);
      button.addEventListener('click', action);
      return button;
    });
    const strip = el('ui5-message-strip', { design, hideCloseButton: actions.length > 0 }, [
      el('span', {}, [text]),
      ...(buttons.length ? [el('div', { className: 'notice-actions' }, buttons)] : []),
    ]);
    strip.addEventListener('close', () => strip.remove());
    this.els.noticeRegion.replaceChildren(strip);
  }

  private showError(message: string, err: unknown): void {
    console.error(message, err);
    const strip = el('ui5-message-strip', { design: 'Negative' }, [message]);
    strip.addEventListener('close', () => strip.remove());
    this.els.errorRegion.replaceChildren(strip);
  }
}

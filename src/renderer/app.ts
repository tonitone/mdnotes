import type {
  ExportFormat,
  ImportReport,
  MenuCommand,
  NoteSummary,
  NotesApi,
  NotesChangedEvent,
  RecoveryEntry,
  SaveResult,
  SearchHit,
  TrashEntry,
} from '../shared/api';
import { MAX_ASSET_BYTES, isImageMime } from '../shared/assets';
import { markdownToWiki } from '../shared/markdown/wiki';
import { openBackupDialog } from './backup-dialog';
import { createEditor, type NoteEditor } from './editor/editor';
import { THEME_CHOICES, getDensity, getThemeChoice, setDensity, setThemeChoice, themeLabel, type ThemeChoice } from './theme';
import { announce, confirmDialog, el, infoDialog, promptDialog, type Ui5Element } from './ui';
import { openVersionDialog } from './versions';
import { formatModified, formatTime, formatVersionTime } from './format';
import { LANGUAGE_CHOICES, isLanguageChoice, t, tp, type LanguageChoice } from '../shared/i18n';

/** Delay after the last keystroke before saving. */
const SAVE_DELAY_MS = 700;
/** Delay before renaming the file after its title. */
const FINALIZE_DELAY_MS = 4000;
const SEARCH_DELAY_MS = 150;
/** Unsaved text is written to the crash recovery store at most this often. */
const RECOVERY_DELAY_MS = 2000;

type View = { kind: 'all' } | { kind: 'trash' } | { kind: 'label'; label: string };

/** Below this width the column layout shows a single column (UI5 FCL breakpoint). */
const narrowQuery = window.matchMedia('(max-width: 599px)');

const $ = <T extends HTMLElement = Ui5Element>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: #${id}`);
  return node as T;
};

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
  private recoveryTimer: number | undefined;
  /** Keeps recovery writes and clears in order. */
  private recoveryQueue: Promise<unknown> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();
  private query = '';
  private searchHits: SearchHit[] | null = null;

  private readonly els = {
    fcl: $('fcl'),
    shell: $('shell'),
    themeItem: $('themeItem'),
    backupItem: $('backupItem'),
    renameLabelButton: $('renameLabelButton'),
    libraryButton: $('libraryButton'),
    versionsButton: $('versionsButton'),
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

  constructor(
    private readonly api: NotesApi,
    private language: LanguageChoice = 'system',
  ) {}

  async start(): Promise<void> {
    this.els.fcl.accessibilityAttributes = {
      startColumn: { role: 'navigation', name: t('library.title') },
      midColumn: { role: 'region', name: t('notes.title') },
      endColumn: { role: 'main', name: t('editor.region') },
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
    els.backupItem.addEventListener('click', () => void this.openBackup());
    els.versionsButton.addEventListener('click', () => void this.openVersions());
    els.renameLabelButton.addEventListener('click', () => void this.renameCurrentLabel());

    els.themeItem.addEventListener('click', (event: Event) => {
      const detail = (event as CustomEvent<{ targetRef: HTMLElement }>).detail;
      event.preventDefault?.();
      els.themeMenu.opener = detail?.targetRef ?? els.themeItem;
      els.themeMenu.open = true;
    });
    els.themeMenu.addEventListener('item-click', (event: Event) => {
      const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
      const { theme, density, language } = item.dataset;
      if (theme) setThemeChoice(theme as ThemeChoice);
      if (density) setDensity(density as 'compact' | 'cozy');
      if (isLanguageChoice(language)) void this.changeLanguage(language);
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
      this.setLayout('TwoColumnsMidExpanded');
      (els.notesList.querySelector('[navigated]') as HTMLElement | null)?.focus();
    });
    els.libraryButton.addEventListener('click', () => {
      this.setLayout('OneColumn');
      const current = (els.libraryList.querySelector('[navigated]') ?? els.labelList.querySelector('[navigated]')) as HTMLElement | null;
      (current ?? els.allNotesItem).focus();
    });
    // Fired on resize and user interaction, not when the app sets the layout.
    els.fcl.addEventListener('layout-change', () => this.updateColumnButtons());

    // The skip link jumps to the editor, or to the note list when no note is open.
    document.querySelector('.skip-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      this.focusContent();
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
      if (command === 'versions') void this.openVersions();
      if (command === 'backup') void this.openBackup();
    });
    this.api.onFlushRequest(() => this.flush());
    this.api.onNotesChanged((event) => void this.onNotesChanged(event));
  }

  private buildThemeMenu(): void {
    const menu = this.els.themeMenu;
    menu.replaceChildren();
    const current = getThemeChoice();
    for (const value of THEME_CHOICES) {
      menu.append(el('ui5-menu-item', { 'attr:text': themeLabel(value), 'data-theme': value, icon: value === current ? 'accept' : '' }));
    }
    menu.append(el('ui5-menu-separator'));
    const density = getDensity();
    for (const value of ['compact', 'cozy'] as const) {
      menu.append(el('ui5-menu-item', { 'attr:text': t(`density.${value}`), 'data-density': value, icon: value === density ? 'accept' : '' }));
    }
    menu.append(el('ui5-menu-separator'));
    menu.append(
      el(
        'ui5-menu-item',
        { 'attr:text': t('language.title'), icon: 'globe', id: 'languageMenuItem' },
        LANGUAGE_CHOICES.map((value) =>
          el('ui5-menu-item', {
            'attr:text': t(`language.${value}`),
            'data-language': value,
            icon: value === this.language ? 'accept' : '',
          }),
        ),
      ),
    );
  }

  /** Saves the language and reloads the window, which applies it everywhere. */
  private async changeLanguage(choice: LanguageChoice): Promise<void> {
    if (choice === this.language) return;
    await this.flush();
    try {
      await this.api.setLanguage(choice);
      this.language = choice;
      window.location.reload();
    } catch (err) {
      this.showError(t('language.reloadFailed'), err);
    }
  }

  private setLayout(layout: 'OneColumn' | 'TwoColumnsMidExpanded' | 'ThreeColumnsEndExpanded'): void {
    this.els.fcl.layout = layout;
    // Column visibility is known after UI5 has rendered the new layout.
    requestAnimationFrame(() => this.updateColumnButtons());
  }

  /** In narrow windows, back buttons lead to the hidden columns. */
  private updateColumnButtons(): void {
    const { fcl } = this.els;
    this.els.backButton.hidden = Boolean(fcl.midColumnVisible);
    this.els.libraryButton.hidden = Boolean(fcl.startColumnVisible) || !fcl.midColumnVisible;
  }

  private focusContent(): void {
    if (!this.els.editorHost.hidden && this.editor) {
      this.editor.focus();
      return;
    }
    const item = (this.els.notesList.querySelector('[navigated]') ?? this.els.notesList.querySelector('ui5-li')) as HTMLElement | null;
    (item ?? this.els.searchInput).focus();
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
      this.showError(t('error.openFolder'), err);
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
    await this.checkRecovery();
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
      this.view.kind === 'trash'
        ? t('library.trash')
        : this.view.kind === 'label'
          ? t('notes.labelTitle', { label: this.view.label })
          : t('notes.title');
    this.els.newNoteButton.hidden = this.view.kind === 'trash';
    this.els.renameLabelButton.hidden = this.view.kind !== 'label';
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
      const entries = this.trash.filter((e) => !q || `${e.title} ${e.preview}`.toLocaleLowerCase().includes(q));
      list.noDataText = q ? t('notes.noHits') : t('trash.empty');
      list.replaceChildren(
        ...entries.map((e) =>
          el('ui5-li', {
            icon: 'document-text',
            description: e.preview || t('notes.noText'),
            additionalText: t('trash.deletedAt', { time: formatModified(e.trashedAt) }),
            navigated: e.trashName === this.currentTrash,
            'data-trash': e.trashName,
          }, [e.title]),
        ),
      );
      return;
    }
    list.noDataText = this.query ? t('notes.noHits') : t('notes.empty');
    list.replaceChildren(
      ...this.visibleNotes().map((note) =>
        el('ui5-li', {
          icon: 'document-text',
          description: note.snippet ?? (note.preview || t('notes.noText')),
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
    // In a single column the empty editor would hide the list; show the list instead.
    this.setLayout(narrowQuery.matches ? 'TwoColumnsMidExpanded' : 'ThreeColumnsEndExpanded');
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
      this.setStatus(t('status.modifiedAt', { time: formatModified(doc.modified) }));
      this.renderTokens(doc.labels);
      this.showView('editor');
      this.setLayout('ThreeColumnsEndExpanded');
      this.updateSelection();
    } catch (err) {
      this.showError(t('error.openNote'), err);
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
      this.setStatus(t('status.created'));
      this.renderTokens([]);
      this.showView('editor');
      this.setLayout('ThreeColumnsEndExpanded');
      this.editor?.focus();
    } catch (err) {
      this.showError(t('error.createNote'), err);
    }
  }

  private onEditorChange(): void {
    if (!this.currentId) return;
    this.dirty = true;
    this.scheduleRecovery();
    if (this.conflict) return;
    this.setStatus(t('status.unsaved'));
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
    this.setStatus(t('status.saving'));
    this.saving = this.saving.then(async () => {
      try {
        const result = await this.api.saveNote(id, body);
        this.applySaveResult(result);
        if (!this.dirty || id !== this.currentId) this.clearRecovery(id);
        if (id === this.currentId && !this.dirty) {
          this.setStatus(t('status.savedAt', { time: formatTime(result.modified) }));
        }
      } catch (err) {
        this.dirty = true;
        this.showError(t('error.save'), err);
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
      this.showError(t('error.rename'), err);
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
      this.showError(t('error.labels'), err);
    }
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  private async saveImages(files: File[]): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      if (!isImageMime(file.type)) {
        this.showError(t('error.imageType', { name: file.name }), file.type);
        continue;
      }
      if (file.size > MAX_ASSET_BYTES) {
        this.showError(t('error.imageSize', { name: file.name }), file.size);
        continue;
      }
      try {
        paths.push(await this.api.saveAsset(new Uint8Array(await file.arrayBuffer()), file.type));
      } catch (err) {
        this.showError(t('error.imageSave'), err);
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
      const alt = await promptDialog(t('image.altTitle'), t('image.altLabel'), t('image.altHint'));
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
    const title = this.notes.find((n) => n.id === id)?.title ?? '';
    try {
      await this.api.trashNote(id);
      this.notes = this.notes.filter((n) => n.id !== id);
      this.closeEditor();
      this.renderLibrary();
      this.renderList();
      announce(t('announce.trashed', { title }));
    } catch (err) {
      this.showError(t('error.trash'), err);
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
      this.setStatus(entry ? t('trash.deletedAt', { time: formatModified(entry.trashedAt) }) : '');
      this.showView('trashEntry');
      this.setLayout('ThreeColumnsEndExpanded');
      this.updateSelection();
    } catch (err) {
      this.showError(t('error.openTrash'), err);
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
      announce(t('announce.restored', { title: summary.title }));
    } catch (err) {
      this.showError(t('error.restore'), err);
    }
  }

  private async deleteCurrentTrashForever(): Promise<void> {
    const name = this.currentTrash;
    if (!name) return;
    const title = this.trash.find((e) => e.trashName === name)?.title ?? '';
    const ok = await confirmDialog(t('confirm.deleteTitle'), t('confirm.deleteText', { title }), t('trash.deleteForever'));
    if (!ok) return;
    try {
      await this.api.deleteFromTrash(name);
      this.trash = this.trash.filter((e) => e.trashName !== name);
      this.closeEditor();
      this.renderList();
      announce(t('announce.deleted', { title }));
    } catch (err) {
      this.showError(t('error.delete'), err);
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
      announce(format === 'wiki' ? t('announce.wikiCopied') : t('announce.markdownCopied'));
    } catch (err) {
      this.showError(t('error.copy'), err);
    }
  }

  private async exportCurrent(format: ExportFormat): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    await this.flush();
    try {
      const target = await this.api.exportNote(id, format);
      if (target) announce(t('announce.exported', { target }));
    } catch (err) {
      this.showError(t('error.export'), err);
    }
  }

  private async exportAll(): Promise<void> {
    await this.flush();
    try {
      const folder = await this.api.exportAll();
      if (folder) announce(t('announce.exportedAll', { folder }));
    } catch (err) {
      this.showError(t('error.export'), err);
    }
  }

  private async importNotes(): Promise<void> {
    await this.flush();
    try {
      const report = await this.api.importNotes();
      if (report) await this.showImportReport(report);
    } catch (err) {
      this.showError(t('error.import'), err);
    }
  }

  private async importDropped(files: File[]): Promise<void> {
    await this.flush();
    try {
      const report = await this.api.importTexts(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
      await this.showImportReport(report);
    } catch (err) {
      this.showError(t('error.import'), err);
    }
  }

  private async showImportReport(report: { imported: number; skipped: number; warnings: string[] }): Promise<void> {
    this.notes = await this.api.listNotes();
    this.renderLibrary();
    await this.runSearch();
    const summary = t('import.summary', { imported: report.imported, skipped: report.skipped });
    if (report.warnings.length === 0) {
      announce(summary);
    } else {
      await infoDialog(t('import.done'), [summary, ...report.warnings]);
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
        this.showNotice('Critical', t('notice.deletedOutside'), [
          { text: t('notice.saveAsNew'), action: () => void this.saveAsNewNote() },
        ]);
        this.conflict = true;
      } else {
        this.closeEditor();
        announce(t('announce.openDeleted'));
      }
      return;
    }

    if (event.changed.includes(id)) {
      if (!this.dirty) {
        await this.reloadCurrent();
        this.showNotice('Information', t('notice.reloaded'));
      } else {
        this.conflict = true;
        window.clearTimeout(this.saveTimer);
        this.showNotice('Critical', t('notice.conflict'), [
          { text: t('notice.loadTheirs'), action: () => void this.resolveConflict('theirs') },
          { text: t('notice.keepMine'), action: () => void this.resolveConflict('mine') },
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
      announce(t('announce.theirsLoaded'));
    } else {
      this.dirty = true;
      await this.save();
      announce(t('announce.mineSaved'));
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
    announce(t('announce.savedAsNew'));
  }

  // -------------------------------------------------------------------------
  // Versions, backup, labels
  // -------------------------------------------------------------------------

  private async openVersions(): Promise<void> {
    const id = this.currentId;
    if (!id || !this.editor) return;
    await this.flush();
    try {
      // Make sure the current state is a version, so it can be compared and restored.
      this.applySaveResult(await this.api.finalizeNote(id));
      const title = this.notes.find((n) => n.id === id)?.title ?? '';
      const doc = await openVersionDialog(this.api, id, title, this.editor.getDoc());
      if (doc && id === this.currentId) {
        this.editor.setDoc(doc.body);
        this.dirty = false;
        this.applySaveResult(doc);
        this.setStatus(t('status.savedAt', { time: formatTime(doc.modified) }));
        announce(t('announce.versionRestored'));
      }
    } catch (err) {
      this.showError(t('error.versions'), err);
    }
  }

  private async openBackup(): Promise<void> {
    await this.flush();
    try {
      await openBackupDialog(this.api, {
        onRestored: (report: ImportReport) => this.showImportReport(report),
        onWorkspaceChanged: (folder: string) => this.showWorkspace(folder),
      });
    } catch (err) {
      this.showError(t('error.backupDialog'), err);
    }
  }

  private async renameCurrentLabel(): Promise<void> {
    if (this.view.kind !== 'label') return;
    const from = this.view.label;
    const to = await promptDialog(t('label.renameTitle'), t('label.newName'), t('label.renameHint'), from, t('dialog.cancel'));
    if (!to || !to.trim() || to.trim() === from) return;
    try {
      const changed = await this.api.renameLabel(from, to);
      this.notes = await this.api.listNotes();
      const renamed = changed[0]?.labels.find((l) => sameLabel(l, to.trim())) ?? to.trim();
      this.view = { kind: 'label', label: renamed };
      const current = this.notes.find((n) => n.id === this.currentId);
      if (current) this.renderTokens(current.labels);
      this.renderLibrary();
      await this.runSearch();
      announce(tp('announce.labelRenamed', changed.length, { from }));
    } catch (err) {
      this.showError(t('error.renameLabel'), err);
    }
  }

  // -------------------------------------------------------------------------
  // Crash recovery
  // -------------------------------------------------------------------------

  private scheduleRecovery(): void {
    if (this.recoveryTimer !== undefined) return;
    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = undefined;
      const id = this.currentId;
      if (!id || !this.dirty || !this.editor) return;
      const body = this.editor.getDoc();
      this.recoveryQueue = this.recoveryQueue.then(() => this.api.writeRecovery(id, body)).catch((err) => console.error(err));
    }, RECOVERY_DELAY_MS);
  }

  private clearRecovery(id: string): void {
    this.recoveryQueue = this.recoveryQueue.then(() => this.api.clearRecovery(id)).catch((err) => console.error(err));
  }

  /** Offers unsaved text left over from a crash, one note at a time. */
  private async checkRecovery(): Promise<void> {
    let entries: RecoveryEntry[];
    try {
      entries = await this.api.listRecovery();
    } catch (err) {
      console.error(err);
      return;
    }
    const entry = entries[0];
    if (!entry) return;
    this.showNotice(
      'Critical',
      t('notice.recovery', { title: entry.title, time: formatVersionTime(entry.savedAt) }),
      [
        { text: t('notice.recover'), action: () => void this.recoverEntry(entry) },
        {
          text: t('notice.discard'),
          action: () => {
            this.els.noticeRegion.replaceChildren();
            this.clearRecovery(entry.id);
            void this.recoveryQueue.then(() => this.checkRecovery());
          },
        },
      ],
    );
  }

  private async recoverEntry(entry: RecoveryEntry): Promise<void> {
    await this.openNote(entry.id);
    const view = this.editor?.view;
    if (this.currentId !== entry.id || !view) return;
    // As a normal edit, so Undo brings back the saved version.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.body } });
    announce(t('announce.recovered'));
    await this.checkRecovery();
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

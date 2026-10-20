import type { MenuCommand, NoteSummary, NotesApi, SaveResult } from '../shared/api';
import { createEditor, type NoteEditor } from './editor/editor';
import { THEME_LABELS, getDensity, getThemeChoice, setDensity, setThemeChoice, type ThemeChoice } from './theme';

/** Delay after the last keystroke before saving. */
const SAVE_DELAY_MS = 700;
/** Delay before renaming the file after its title. */
const FINALIZE_DELAY_MS = 4000;

/** UI5 elements are only accessed through the properties used here. */
type Ui5Element = HTMLElement & Record<string, any>;

const $ = <T extends HTMLElement = Ui5Element>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el as T;
};

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function formatModified(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  return date.toDateString() === today.toDateString() ? timeFormat.format(date) : dateFormat.format(date);
}

export class App {
  private notes: NoteSummary[] = [];
  private currentId: string | null = null;
  private editor: NoteEditor | null = null;
  private dirty = false;
  private saveTimer: number | undefined;
  private finalizeTimer: number | undefined;
  private saving: Promise<void> = Promise.resolve();
  private filter = '';

  private readonly els = {
    fcl: $('fcl'),
    shell: $('shell'),
    themeItem: $('themeItem'),
    workspaceItem: $('workspaceItem'),
    themeMenu: $('themeMenu'),
    browserModeStrip: $('browserModeStrip'),
    workspacePath: $('workspacePath'),
    notesList: $('notesList'),
    newNoteButton: $('newNoteButton'),
    searchInput: $('searchInput'),
    backButton: $('backButton'),
    fileName: $('fileName'),
    saveStatus: $('saveStatus'),
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
    this.els.browserModeStrip.hidden = this.api.mode !== 'browser';
    this.editor = createEditor(this.els.editorHost, () => this.onEditorChange());
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

    els.notesList.addEventListener('selection-change', (event: Event) => {
      const selected = (event as CustomEvent<{ selectedItems: HTMLElement[] }>).detail.selectedItems[0];
      const id = selected?.dataset.id;
      if (id && id !== this.currentId) void this.openNote(id);
    });

    els.searchInput.addEventListener('input', () => {
      this.filter = String(els.searchInput.value ?? '').trim().toLowerCase();
      this.renderList();
    });

    els.backButton.addEventListener('click', () => {
      els.fcl.layout = 'TwoColumnsMidExpanded';
      (els.notesList.querySelector('[selected]') as HTMLElement | null)?.focus();
    });
    els.fcl.addEventListener('layout-change', (event: Event) => {
      const detail = (event as CustomEvent<{ midColumnVisible: boolean }>).detail;
      els.backButton.hidden = detail.midColumnVisible;
    });

    this.api.onMenuCommand((command: MenuCommand) => {
      if (command === 'new-note') void this.newNote();
      if (command === 'choose-workspace') void this.chooseWorkspace();
      if (command === 'find') (els.searchInput as HTMLElement).focus();
    });
    this.api.onFlushRequest(() => this.flush());
  }

  private buildThemeMenu(): void {
    const menu = this.els.themeMenu;
    menu.replaceChildren();
    const current = getThemeChoice();
    for (const [value, label] of Object.entries(THEME_LABELS)) {
      const item = document.createElement('ui5-menu-item') as Ui5Element;
      item.setAttribute('text', label);
      item.dataset.theme = value;
      item.icon = value === current ? 'accept' : '';
      menu.append(item);
    }
    menu.append(document.createElement('ui5-menu-separator'));
    const density = getDensity();
    for (const [value, label] of [['compact', 'Kompakt'], ['cozy', 'Komfortabel']] as const) {
      const item = document.createElement('ui5-menu-item') as Ui5Element;
      item.setAttribute('text', label);
      item.dataset.density = value;
      item.icon = value === density ? 'accept' : '';
      menu.append(item);
    }
  }

  // -------------------------------------------------------------------------
  // Workspace and list
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
    this.els.newNoteButton.disabled = false;
    this.els.searchInput.disabled = false;
    this.currentId = null;
    this.notes = await this.api.listNotes();
    this.renderList();
    this.showView('noSelection');
  }

  private renderList(): void {
    const list = this.els.notesList;
    const visible = this.filter
      ? this.notes.filter((n) => `${n.title} ${n.preview}`.toLowerCase().includes(this.filter))
      : this.notes;
    list.noDataText = this.filter ? 'Keine Treffer' : 'Noch keine Notizen';
    list.replaceChildren(
      ...visible.map((note) => {
        const item = document.createElement('ui5-li') as Ui5Element;
        item.textContent = note.title;
        item.description = note.preview || 'Kein weiterer Text';
        item.additionalText = formatModified(note.modified);
        item.icon = 'document-text';
        item.tooltip = note.fileName;
        item.dataset.id = note.id;
        item.selected = note.id === this.currentId;
        return item;
      }),
    );
  }

  /** Marks the current note without rebuilding the list (keeps focus). */
  private updateSelection(): void {
    for (const item of this.els.notesList.children as HTMLCollectionOf<Ui5Element>) {
      item.selected = item.dataset.id === this.currentId;
    }
  }

  /** Updates an entry after saving and moves it to the top. */
  private applySaveResult(result: SaveResult): void {
    const index = this.notes.findIndex((n) => n.id === result.id);
    if (index === -1) return;
    const updated = { ...this.notes[index], ...result };
    this.notes.splice(index, 1);
    this.notes.unshift(updated);
    this.renderList();
    if (result.id === this.currentId) this.els.fileName.textContent = result.fileName;
  }

  private showView(view: 'editor' | 'noSelection' | 'noWorkspace'): void {
    this.els.editorHost.hidden = view !== 'editor';
    this.els.noSelection.hidden = view !== 'noSelection';
    this.els.noWorkspace.hidden = view !== 'noWorkspace';
    if (view !== 'editor') {
      this.els.fileName.textContent = '';
      this.els.saveStatus.textContent = '';
    }
  }

  // -------------------------------------------------------------------------
  // Open, create and save notes
  // -------------------------------------------------------------------------

  private async openNote(id: string): Promise<void> {
    await this.flush();
    try {
      const doc = await this.api.readNote(id);
      this.currentId = id;
      this.editor?.setDoc(doc.body);
      this.els.fileName.textContent = doc.fileName;
      this.setStatus(`Zuletzt geändert ${formatModified(doc.modified)}`);
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
      this.filter = '';
      this.els.searchInput.value = '';
      this.currentId = doc.id;
      this.renderList();
      this.editor?.setDoc(doc.body);
      this.els.fileName.textContent = doc.fileName;
      this.setStatus('Neu angelegt');
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
    if (!id || !this.dirty || !this.editor) return this.saving;
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
    if (!id) return;
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
  // Feedback
  // -------------------------------------------------------------------------

  private setStatus(text: string): void {
    // Only set on a real change, otherwise screen readers announce it twice.
    if (this.els.saveStatus.textContent !== text) this.els.saveStatus.textContent = text;
  }

  private showError(message: string, err: unknown): void {
    console.error(message, err);
    this.els.errorRegion.textContent = '';
    const strip = document.createElement('ui5-message-strip') as Ui5Element;
    strip.design = 'Negative';
    strip.textContent = message;
    strip.addEventListener('close', () => strip.remove());
    this.els.errorRegion.append(strip);
  }
}

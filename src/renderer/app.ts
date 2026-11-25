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
import { renderFinished } from '@ui5/webcomponents-base/dist/Render.js';
import { MAX_ASSET_BYTES, MAX_ATTACHMENT_BYTES, attachmentNameFromPath, isAllowedAttachment, isImageMime } from '../shared/assets';
import { normalizeLabels } from '../shared/note-store';
import { DEFAULT_NOTE_SORT, createdTime, groupNotes, isNoteSort, sortNotes, type NoteSort } from '../shared/note-list';
import { markdownToHtml } from '../shared/markdown/html';
import { markdownToWiki } from '../shared/markdown/wiki';
import { openBackupDialog } from './backup-dialog';
import { isOutlineDialogOpen, openOutlineDialog } from './outline-dialog';
import { EditorView } from '@codemirror/view';
import { extractOutline, type OutlineEntry } from '../shared/markdown/outline';
import { countText } from '../shared/markdown/count';
import { linksTo } from '../shared/wikilinks';
import { folderOf } from '../shared/workspace-path';
import { isShortcutsDialogOpen, openShortcutsDialog } from './shortcuts-dialog';
import { createEditor, type NoteEditor } from './editor/editor';
import { FORMAT_SHORTCUTS } from './editor/format-commands';
import { shortcutLabel, type FormatKind, type FormatOutcome } from './editor/format';
import { THEME_CHOICES, getDensity, getThemeChoice, setDensity, setThemeChoice, themeLabel, type ThemeChoice } from './theme';
import { announce, confirmDialog, el, infoDialog, promptDialog, type Ui5Element } from './ui';
import { observeCompact } from './compact';
import { openVersionDialog } from './versions';
import { collationLocale, formatModified, formatTime, formatVersionTime, groupTitle, shortenPath } from './format';
import { LANGUAGE_CHOICES, isLanguageChoice, t, tp, type LanguageChoice, type MessageKey } from '../shared/i18n';

/** Delay after the last keystroke before saving. */
const SAVE_DELAY_MS = 700;
/** Delay before renaming the file after its title. */
const FINALIZE_DELAY_MS = 4000;
/** How long the "saved" status stays at full strength before it fades. */
const STATUS_FADE_MS = 5000;
const SEARCH_DELAY_MS = 150;
/** Below this width of the middle column, "New note" shows only its icon. */
const NEW_NOTE_COMPACT_REM = 17;
/** Extra room for each further icon button in the header (rename label, back to library). */
const HEADER_BUTTON_REM = 5;
/** Room for the sort button (2.25rem) and its gap, plus a little slack; part of every view except the trash. */
const SORT_BUTTON_REM = 2.75;
/** Unsaved text is written to the crash recovery store at most this often. */
const RECOVERY_DELAY_MS = 2000;

/** How long the "Undo" strip stays after a note was moved to the trash. */
const UNDO_VISIBLE_MS = 10000;

type View = { kind: 'all' } | { kind: 'trash' } | { kind: 'label'; label: string };

/** Edit with live preview, source next to a rendered preview, or preview only. */
type ViewMode = 'edit' | 'split' | 'preview';
const VIEW_MODES: ViewMode[] = ['edit', 'split', 'preview'];
const PREVIEW_DELAY_MS = 150;
/** Below this width of the editor column the view switch shows only icons. */
const COMPACT_VIEW_SWITCH_REM = 30;
const VIEW_MODE_ICONS: Record<ViewMode, string> = { edit: 'edit', split: 'screen-split-two', preview: 'show' };

function readViewMode(): ViewMode {
  try {
    const value = localStorage.getItem('mdnotes.viewMode') as ViewMode | null;
    return value && VIEW_MODES.includes(value) ? value : 'edit';
  } catch {
    return 'edit';
  }
}

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
  private statusFadeTimer: number | undefined;
  private trash: TrashEntry[] = [];
  private view: View = { kind: 'all' };
  private currentId: string | null = null;
  private currentTrash: string | null = null;
  private editor: NoteEditor | null = null;
  private dirty = false;
  /** An outside change is waiting for the user's decision; autosave is paused. */
  private conflict = false;
  private compactThresholdRem = 0;
  private stopCompactObserver: (() => void) | null = null;
  private saveTimer: number | undefined;
  private finalizeTimer: number | undefined;
  private searchTimer: number | undefined;
  private recoveryTimer: number | undefined;
  /** Keeps recovery writes and clears in order. */
  private recoveryQueue: Promise<unknown> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();
  private query = '';
  private fileName = '';
  private compactViewSwitch = false;
  /** The user collapsed the library column in a wide window; app-driven layouts must keep it hidden. */
  private libraryCollapsed = false;
  private searchHits: SearchHit[] | null = null;
  private viewMode: ViewMode = readViewMode();
  private previewTimer: number | undefined;
  private currentView: 'editor' | 'trashEntry' | 'noSelection' | 'noWorkspace' = 'noSelection';
  /** A format chosen in the Format menu runs once the menu has closed and given the focus back. */
  private pendingFormat: FormatKind | null = null;
  private pendingOutline = false;
  private sort: NoteSort = DEFAULT_NOTE_SORT;
  /** The note whose context menu is open in the list. */
  private contextNoteId: string | null = null;
  /** Pin toggle chosen in the list's context menu; runs once the menu has closed. */
  private pendingContextPin = false;
  private undoTimer = 0;

  private readonly els = {
    fcl: $('fcl'),
    shell: $('shell'),
    themeItem: $('themeItem'),
    languageItem: $('languageItem'),
    backupItem: $('backupItem'),
    renameLabelButton: $('renameLabelButton'),
    libraryButton: $('libraryButton'),
    versionsButton: $('versionsButton'),
    workspaceItem: $('workspaceItem'),
    themeMenu: $('themeMenu'),
    languageMenu: $('languageMenu'),
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
    sortButton: $('sortButton'),
    sortMenu: $('sortMenu'),
    noteContextMenu: $('noteContextMenu'),
    contextPinItem: $('contextPinItem'),
    pinMenuItem: $('pinMenuItem'),
    searchInput: $('searchInput'),
    backButton: $('backButton'),
    editorColumn: $('editorColumn'),
    saveStatus: $('saveStatus'),
    textCount: $('textCount'),
    noteActions: $('noteActions'),
    exportButton: $('exportButton'),
    exportMenu: $('exportMenu'),
    editorMoreButton: $('editorMoreButton'),
    editorMoreMenu: $('editorMoreMenu'),
    formatToolbarRow: $('formatToolbarRow'),
    formatToolbar: $('formatToolbar'),
    attachInput: $<HTMLInputElement>('attachInput'),
    attachMenuItem: $('attachMenuItem'),
    formatMenuItem: $('formatMenuItem'),
    deleteButton: $('deleteButton'),
    trashActions: $('trashActions'),
    restoreButton: $('restoreButton'),
    deleteForeverButton: $('deleteForeverButton'),
    labelRow: $('labelRow'),
    labelInput: $('labelInput'),
    noticeRegion: $('noticeRegion'),
    undoRegion: $('undoRegion'),
    errorRegion: $('errorRegion'),
    editorHost: $('editor-host'),
    editorArea: $('editorArea'),
    previewPane: $('previewPane'),
    backlinksRegion: $('backlinksRegion'),
    backlinksList: $('backlinksList'),
    viewModeButton: $('viewModeButton'),
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
    // The logo area (logo plus title, or the logo alone in narrow windows) is a
    // link; its accessible name must contain the visible title. The logo image
    // itself has alt="", so the name is announced once.
    this.els.shell.accessibilityAttributes = { logo: { name: 'mdnotes' } };
    this.els.browserModeStrip.hidden = this.api.mode !== 'browser';
    this.editor = createEditor(this.els.editorHost, {
      onChange: (doc) => this.onEditorChange(doc),
      resolveAsset: (src) => this.api.assetUrl(src),
      saveImages: (files) => this.saveImages(files),
      onImagesInserted: (inserted) => void this.askForAltTexts(inserted),
      saveAttachments: (files) => this.saveAttachments(files),
      attachments: {
        open: (src) => void this.openAttachment(src),
        reveal: (src) => void this.revealAttachment(src),
      },
      onFormat: (outcome) => this.announceFormat(outcome),
      links: {
        // A note does not link to itself.
        targets: () => this.notes.filter((n) => n.id !== this.currentId).map((n) => ({ id: n.id, title: n.title })),
        open: (id) => void this.openNote(id),
      },
    });
    // Expose the editor to e2e tests in browser mode only.
    if (__BROWSER_MODE__) (window as unknown as { __editorView: unknown }).__editorView = this.editor.view;
    this.buildThemeMenu();
    this.buildLanguageMenu();
    this.bindEvents();
    this.labelFormatShortcuts();
    this.observeMiddleColumn();
    this.applyViewMode();
    try {
      this.sort = await this.api.getNoteSort();
    } catch (err) {
      console.error(err);
    }
    this.updateSortUi();

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
    // The logo is the home link: back to all notes (UI5 fires this on click, Enter and Space).
    els.shell.addEventListener('logo-click', () => void this.goHome());
    els.versionsButton.addEventListener('click', () => void this.openVersions());
    els.renameLabelButton.addEventListener('click', () => void this.renameCurrentLabel());

    this.openMenuFromShellbar(els.themeItem, els.themeMenu);
    this.openMenuFromShellbar(els.languageItem, els.languageMenu);
    els.themeMenu.addEventListener('item-click', (event: Event) => {
      const item = (event as CustomEvent<{ item: HTMLElement }>).detail.item;
      const { theme, density } = item.dataset;
      if (theme) setThemeChoice(theme as ThemeChoice);
      if (density) setDensity(density as 'compact' | 'cozy');
      this.buildThemeMenu();
    });
    els.languageMenu.addEventListener('item-click', (event: Event) => {
      const language = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.language;
      if (isLanguageChoice(language)) void this.changeLanguage(language);
    });

    // Library: all notes, trash and labels.
    els.libraryList.addEventListener('item-click', (event: Event) => {
      const view = (event as CustomEvent<{ item: HTMLElement }>).detail.item?.dataset.view;
      if (view === 'all' || view === 'trash') void this.setView({ kind: view });
    });
    els.backlinksList.addEventListener('item-click', (event: Event) => {
      const id = (event as CustomEvent<{ item: HTMLElement }>).detail.item?.dataset.id;
      if (id) void this.openNote(id);
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
      // The open entry is still behind the list in a narrow window (e.g. after the logo click): show it again.
      const isCurrent = item?.dataset.id ? item.dataset.id === this.currentId : item?.dataset.trash === this.currentTrash;
      if (isCurrent && narrowQuery.matches) this.setLayout('ThreeColumnsEndExpanded');
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

    els.sortButton.addEventListener('click', () => {
      els.sortMenu.opener = els.sortButton;
      els.sortMenu.open = true;
    });
    els.sortMenu.addEventListener('item-click', (event: Event) => {
      const sort = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.sort;
      if (isNoteSort(sort)) void this.changeSort(sort);
      // UI5 toggles the clicked item right after this event; set the real state afterwards.
      queueMicrotask(() => this.updateSortUi());
    });

    // Context menu of a note in the list: right click, the context menu key or Shift+F10.
    els.notesList.addEventListener('contextmenu', (event: MouseEvent) => {
      const item = this.noteItemFrom(event);
      if (!item) return;
      event.preventDefault();
      this.openNoteContextMenu(item);
    });
    els.notesList.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      const item = this.noteItemFrom(event);
      if (!item) return;
      event.preventDefault();
      this.openNoteContextMenu(item);
    });
    els.noteContextMenu.addEventListener('item-click', (event: Event) => {
      const action = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset.action;
      if (action === 'toggle-pin') this.pendingContextPin = true;
    });
    els.noteContextMenu.addEventListener('close', () => {
      const id = this.contextNoteId;
      const run = this.pendingContextPin;
      this.contextNoteId = null;
      this.pendingContextPin = false;
      const note = id ? this.notes.find((n) => n.id === id) : undefined;
      // The list is rebuilt afterwards, so the focus moves to the note's new entry.
      if (run && note) void this.setPinned(note.id, !note.pinned, { focusListItem: true });
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
    els.editorMoreButton.addEventListener('click', () => {
      this.updatePinItem(els.pinMenuItem, this.currentNote()?.pinned === true);
      els.editorMoreMenu.opener = els.editorMoreButton;
      els.editorMoreMenu.open = true;
    });
    els.editorMoreMenu.addEventListener('item-click', (event: Event) => {
      const { action, format } = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset;
      if (action === 'copy-file-name') void this.copyFileName();
      if (action === 'duplicate') void this.duplicateCurrent();
      // The menu item is the visible control; the hidden file input only opens the system's file dialog.
      if (action === 'attach') {
        els.attachInput.value = '';
        els.attachInput.click();
      }
      if (action === 'outline') this.pendingOutline = true;
      if (action === 'toggle-pin') {
        const note = this.currentNote();
        if (note) void this.setPinned(note.id, !note.pinned);
      }
      if (format) this.pendingFormat = format as FormatKind;
    });
    els.editorMoreMenu.addEventListener('close', (event: Event) => {
      // The submenu fires its own close event; only the whole menu closing counts.
      if (event.target !== els.editorMoreMenu) return;
      const kind = this.pendingFormat;
      this.pendingFormat = null;
      const outline = this.pendingOutline;
      this.pendingOutline = false;
      if (outline) requestAnimationFrame(() => void this.openOutline());
      // The menu gives the focus back to its button; wait for that, then move on to the editor.
      if (kind) requestAnimationFrame(() => this.runFormat(kind));
    });
    for (const button of els.formatToolbar.querySelectorAll<HTMLElement>('[data-format]')) {
      button.addEventListener('click', () => this.runFormat(button.dataset.format as FormatKind));
    }
    els.attachInput.addEventListener('change', () => {
      const files = [...(els.attachInput.files ?? [])];
      if (files.length > 0) void this.editor?.insertFiles(files);
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
      // In a wide window the button reopens a collapsed column next to the others.
      this.libraryCollapsed = false;
      this.setLayout(narrowQuery.matches ? 'OneColumn' : 'ThreeColumnsEndExpanded');
      const current = (els.libraryList.querySelector('[navigated]') ?? els.labelList.querySelector('[navigated]')) as HTMLElement | null;
      (current ?? els.allNotesItem).focus();
    });
    // Fired on resize and user interaction, not when the app sets the layout.
    els.fcl.addEventListener('layout-change', (event: Event) => {
      // Remember the user's choice for the library column; resizing must not change it.
      const { resized } = (event as CustomEvent<{ resized?: boolean }>).detail ?? {};
      if (!narrowQuery.matches && !resized) this.libraryCollapsed = !els.fcl.startColumnVisible;
      this.updateColumnButtons();
    });
    // A column layout chosen in a narrow window must not outlive the window size.
    narrowQuery.addEventListener('change', () => this.syncLayoutToWidth());
    this.syncLayoutToWidth();

    // Observed for the lifetime of the window, so the disposer is not needed.
    observeCompact(els.editorColumn, COMPACT_VIEW_SWITCH_REM, (compact) => {
      this.compactViewSwitch = compact;
      this.updateViewSwitchLabels();
    });
    els.viewModeButton.addEventListener('selection-change', (event: Event) => {
      const item = (event as CustomEvent<{ selectedItems: HTMLElement[] }>).detail.selectedItems?.[0];
      const mode = item?.dataset.mode as ViewMode | undefined;
      if (mode && VIEW_MODES.includes(mode)) this.setViewMode(mode);
    });
    // Links in the preview open in the default browser (Electron) or a new tab.
    els.previewPane.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest('a');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener');
      else if (attachmentNameFromPath(href)) void this.openAttachment(href);
      // Footnote references and back links jump within the preview.
      else if (/^#fn(ref)?-\d+$/.test(href)) {
        const target = els.previewPane.querySelector<HTMLElement>(href);
        target?.scrollIntoView({ block: 'center' });
        // Focus moves along: to the back link of a footnote, or to the reference itself.
        (target?.matches('a') ? target : target?.querySelector<HTMLElement>('.footnote-back'))?.focus();
      }
    });
    // In split view the preview follows the editor's scroll position.
    this.editor?.view.scrollDOM.addEventListener('scroll', () => {
      if (this.viewMode !== 'split') return;
      const from = this.editor!.view.scrollDOM;
      const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
      els.previewPane.scrollTop = ratio * (els.previewPane.scrollHeight - els.previewPane.clientHeight);
    });

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

    // Cmd+/ (Ctrl+/ elsewhere). Capture phase, so the editor keymap does not take the key first.
    document.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key !== '/' || !(event.metaKey || event.ctrlKey) || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        void this.openShortcuts();
      },
      true,
    );

    this.api.onMenuCommand((command: MenuCommand) => {
      if (command === 'new-note') void this.newNote();
      if (command === 'choose-workspace') void this.chooseWorkspace();
      if (command === 'find') (els.searchInput as HTMLElement).focus();
      if (command === 'delete-note') void this.trashCurrent();
      if (command === 'import') void this.importNotes();
      if (command === 'export-all') void this.exportAll();
      if (command === 'versions') void this.openVersions();
      if (command === 'outline') void this.openOutline();
      if (command === 'backup') void this.openBackup();
      if (command === 'shortcuts') void this.openShortcuts();
      if (command === 'view-edit') this.setViewMode('edit');
      if (command === 'view-split') this.setViewMode('split');
      if (command === 'view-preview') this.setViewMode('preview');
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
  }

  private buildLanguageMenu(): void {
    const menu = this.els.languageMenu;
    menu.replaceChildren();
    for (const value of LANGUAGE_CHOICES) {
      menu.append(el('ui5-menu-item', { 'attr:text': t(`language.${value}`), 'data-language': value, icon: value === this.language ? 'accept' : '' }));
    }
  }

  /** Opens `menu` from its shellbar item, also when the item sits in the overflow popover. */
  private openMenuFromShellbar(item: Ui5Element, menu: Ui5Element): void {
    item.addEventListener('click', (event: Event) => {
      const detail = (event as CustomEvent<{ targetRef: HTMLElement }>).detail;
      event.preventDefault?.();
      menu.opener = detail?.targetRef ?? item;
      menu.open = true;
    });
  }

  /** Narrow middle column: "New note" keeps only its icon; tooltip and accessible name stay. */
  private observeMiddleColumn(): void {
    this.updateCompactObserver();
  }

  /**
   * The threshold grows with the other buttons that are visible in the header,
   * so the title always keeps room. Observing again reports the state once.
   */
  private updateCompactObserver(): void {
    const column = document.querySelector<HTMLElement>('section[slot="midColumn"]');
    if (!column) return;
    const extra = Number(!this.els.renameLabelButton.hidden) + Number(!this.els.libraryButton.hidden);
    const sort = this.els.sortButton.hidden ? 0 : SORT_BUTTON_REM;
    const thresholdRem = NEW_NOTE_COMPACT_REM + extra * HEADER_BUTTON_REM + sort;
    if (thresholdRem === this.compactThresholdRem) return;
    this.compactThresholdRem = thresholdRem;
    this.stopCompactObserver?.();
    this.stopCompactObserver = observeCompact(column, thresholdRem, (compact) => {
      this.els.newNoteButton.textContent = compact ? '' : t('notes.new');
    });
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
    const keepLibraryHidden = this.libraryCollapsed && !narrowQuery.matches && layout === 'ThreeColumnsEndExpanded';
    this.els.fcl.layout = keepLibraryHidden ? 'ThreeColumnsStartHiddenEndExpanded' : layout;
    // Column visibility is known after UI5 has rendered the new layout.
    requestAnimationFrame(() => this.updateColumnButtons());
  }

  /** Wide: all columns. Narrow: keep an open entry, otherwise show the list instead of the empty editor. */
  private syncLayoutToWidth(): void {
    if (!narrowQuery.matches) this.setLayout('ThreeColumnsEndExpanded');
    else if (this.currentId === null && this.currentTrash === null) this.setLayout('TwoColumnsMidExpanded');
  }

  /** In narrow windows, back buttons lead to the hidden columns. */
  private updateColumnButtons(): void {
    const { fcl } = this.els;
    this.els.backButton.hidden = Boolean(fcl.midColumnVisible);
    this.els.libraryButton.hidden = Boolean(fcl.startColumnVisible) || !fcl.midColumnVisible;
    this.updateCompactObserver();
  }

  // -------------------------------------------------------------------------
  // View modes: edit, split, preview
  // -------------------------------------------------------------------------

  private loadDoc(body: string, options?: { readOnly?: boolean }): void {
    this.editor?.setDoc(body, options);
    this.updateCount(body);
    this.renderPreview();
  }

  /** Shows the word and character count next to the save status. */
  private updateCount(body: string): void {
    const { words, chars } = countText(body);
    this.els.textCount.textContent = t('count.label', { words: words.toLocaleString(), chars: chars.toLocaleString() });
    this.els.textCount.hidden = false;
  }

  private setViewMode(mode: ViewMode): void {
    const editorHadFocus = this.els.editorHost.contains(document.activeElement);
    this.viewMode = mode;
    try {
      localStorage.setItem('mdnotes.viewMode', mode);
    } catch {
      // No storage: the mode only lasts for this session.
    }
    this.applyViewMode();
    // Keep focus where the user can continue: the preview has no editor.
    if (mode === 'preview' && editorHadFocus) this.els.previewPane.focus();
    else if (mode !== 'preview' && this.els.previewPane.contains(document.activeElement)) this.editor?.focus();
  }

  /** Narrow column: icons only. Tooltip and accessible name always carry the translated text. */
  private updateViewSwitchLabels(): void {
    for (const item of this.els.viewModeButton.children as HTMLCollectionOf<Ui5Element>) {
      const mode = item.dataset.mode as ViewMode;
      const label = t(`view.${mode}`);
      item.textContent = this.compactViewSwitch ? '' : label;
      item.icon = this.compactViewSwitch ? VIEW_MODE_ICONS[mode] : '';
      item.tooltip = label;
      item.accessibleName = label;
    }
  }

  /**
   * Runs a format on the editor and puts the focus back into it. A button in the toolbar's
   * overflow menu closes that menu right after its click event, and the menu gives the focus back
   * to the overflow button; so the editor takes the focus once the click has been handled.
   */
  private runFormat(kind: FormatKind): void {
    if (!this.editor || this.viewMode === 'preview' || this.currentView !== 'editor') return;
    this.editor.format(kind);
    queueMicrotask(() => this.editor?.focus());
  }

  /** Quiet announcement (no toast): what a shortcut did is otherwise invisible to screen readers. */
  private announceFormat({ kind, on, level }: FormatOutcome): void {
    if (kind === 'table') return;
    const name = t(`format.${kind}` as MessageKey);
    const message = kind === 'heading' && level ? t('format.announceHeading', { level: String(level) }) : t(on ? 'format.announceOn' : 'format.announceOff', { name });
    announce(message, { toast: false });
  }

  /** Tooltips and Format menu entries name the shortcut of their action. */
  private labelFormatShortcuts(): void {
    const mac = /mac|iphone|ipad/i.test(navigator.platform);
    const names = { ctrl: t('format.keyCtrl'), shift: t('format.keyShift') };
    const label = (kind: FormatKind): string | null => {
      const shortcut = FORMAT_SHORTCUTS[kind];
      return shortcut ? shortcutLabel(shortcut.key, { mac, shift: shortcut.shift, names }) : null;
    };
    for (const button of this.els.formatToolbar.querySelectorAll<HTMLElement>('[data-format]')) {
      const kind = button.dataset.format as FormatKind;
      const keys = label(kind);
      if (keys) button.setAttribute('tooltip', t('format.withShortcut', { name: t(`format.${kind}` as MessageKey), shortcut: keys }));
    }
    for (const item of this.els.formatMenuItem.querySelectorAll<Ui5Element>('[data-format]')) {
      const shortcut = FORMAT_SHORTCUTS[item.dataset.format as FormatKind];
      if (!shortcut) continue;
      item.additionalText = label(item.dataset.format as FormatKind);
      // Screen readers get the shortcut from aria-keyshortcuts; UI5 then hides the visible text from them.
      const aria = [mac ? 'Meta' : 'Control', shortcut.shift ? 'Shift' : '', shortcut.key.toUpperCase()].filter(Boolean).join('+');
      item.accessibilityAttributes = { ariaKeyShortcuts: aria };
    }
  }

  /**
   * The toolbar and the Format menu only work on an editable source, not in the preview or the
   * trash. Hiding the row is enough: the toolbar lays itself out again through its own resize
   * handler once it is shown.
   */
  private updateFormatUi(): void {
    const editable = this.currentView === 'editor' && this.viewMode !== 'preview';
    this.els.formatToolbarRow.hidden = !editable;
    this.els.formatMenuItem.disabled = !editable;
    this.els.attachMenuItem.disabled = !editable;
  }

  private applyViewMode(): void {
    const mode = this.viewMode;
    this.els.editorArea.dataset.mode = mode;
    this.els.editorHost.hidden = mode === 'preview';
    this.els.previewPane.hidden = mode === 'edit';
    // Next to the preview the editor shows plain source.
    this.editor?.setLivePreview(mode === 'edit');
    for (const item of this.els.viewModeButton.children as HTMLCollectionOf<Ui5Element>) item.selected = item.dataset.mode === mode;
    this.updateFormatUi();
    this.renderPreview();
  }

  private schedulePreview(): void {
    if (this.viewMode === 'edit') return;
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.renderPreview(), PREVIEW_DELAY_MS);
  }

  private renderPreview(): void {
    if (this.viewMode === 'edit' || !this.editor) return;
    // Safe: the renderer escapes all text, allows only known tags and safe link targets.
    this.els.previewPane.innerHTML = markdownToHtml(this.editor.getDoc(), {
      resolveImage: (src) => this.api.assetUrl(src) ?? src,
    });
  }

  private focusContent(): void {
    if (!this.els.editorArea.hidden && this.editor) {
      if (this.viewMode === 'preview') this.els.previewPane.focus();
      else this.editor.focus();
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
    this.els.workspacePath.textContent = shortenPath(workspace);
    // The full path is available as tooltip.
    this.els.workspacePath.title = workspace;
    for (const control of [this.els.newNoteButton, this.els.moreButton, this.els.sortButton, this.els.searchInput]) control.disabled = false;
    this.closeEditor();
    this.notes = await this.api.listNotes();
    this.view = { kind: 'all' };
    this.renderLibrary();
    this.renderList();
    await this.checkRecovery();
  }

  private async setView(view: View, options: { keepEditor?: boolean } = {}): Promise<void> {
    await this.flush();
    this.view = view;
    if (!options.keepEditor) this.closeEditor();
    if (view.kind === 'trash') this.trash = await this.api.listTrash();
    this.renderLibrary();
    await this.runSearch();
  }

  /**
   * Home is the "All notes" list. An open note stays open (every note is part of "All notes"),
   * a trash entry is not, so it is closed. In a narrow window the list replaces the editor column.
   */
  private async goHome(): Promise<void> {
    if (this.currentView === 'noWorkspace') return;
    const keepEditor = this.currentView === 'editor' && this.currentId !== null;
    await this.setView({ kind: 'all' }, { keepEditor });
    if (!keepEditor) return;
    this.setLayout(narrowQuery.matches ? 'TwoColumnsMidExpanded' : 'ThreeColumnsEndExpanded');
    // The list was just rebuilt; its entries are only focusable once UI5 has rendered them.
    await renderFinished();
    const target = this.els.notesList.querySelector('[navigated]') ?? this.els.notesList.querySelector('ui5-li');
    (target as HTMLElement | null)?.focus();
  }

  private renderLibrary(): void {
    const { view } = this;
    this.els.allNotesItem.navigated = view.kind === 'all';
    this.els.trashItem.navigated = view.kind === 'trash';
    this.els.allNotesItem.additionalText = String(this.notes.length);

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
    // The trash is always in the order of deletion.
    this.els.sortButton.hidden = this.view.kind === 'trash';
    this.els.renameLabelButton.hidden = this.view.kind !== 'label';
    this.updateCompactObserver();
  }

  private async runSearch(): Promise<void> {
    this.query = String(this.els.searchInput.value ?? '').trim();
    this.searchHits = this.query && this.view.kind !== 'trash' ? await this.api.searchNotes(this.query) : null;
    this.renderList();
  }

  /** Search results in the order of relevance; otherwise the notes in the chosen order, pinned first. */
  private visibleNotes(): Array<NoteSummary & { snippet?: string }> {
    const { view } = this;
    const inView = (n: NoteSummary) => view.kind !== 'label' || n.labels.some((l) => sameLabel(l, view.label));
    if (!this.searchHits) return sortNotes(this.notes.filter(inView), this.sort, collationLocale());
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
        ...entries.map((e) => {
          const description = e.preview || t('notes.noText');
          const time = t('trash.deletedAt', { time: formatModified(e.trashedAt) });
          // Pinned notes keep their pin in the trash; it can only be changed after restoring.
          return el('ui5-li', {
            icon: e.pinned ? 'pushpin-on' : 'document-text',
            description,
            additionalText: time,
            navigated: e.trashName === this.currentTrash,
            ...(e.pinned ? { accessibleName: t('notes.pinnedItem', { title: e.title, description, time }) } : {}),
            'data-trash': e.trashName,
          }, [e.title]);
        }),
      );
      return;
    }
    list.noDataText = this.query ? t('notes.noHits') : t('notes.empty');
    const notes = this.visibleNotes();
    // Date groups only for a date order without a search, like Apple Notes.
    const sort = this.sort;
    if (this.searchHits || sort === 'title') {
      list.replaceChildren(...notes.map((note) => this.noteItem(note)));
      return;
    }
    list.replaceChildren(
      ...groupNotes(notes, sort, Date.now()).map(({ key, group, notes: members }) =>
        el('ui5-li-group', { headerText: groupTitle(group), 'data-group': key }, members.map((note) => this.noteItem(note))),
      ),
    );
  }

  private noteItem(note: NoteSummary & { snippet?: string }): Ui5Element {
    const text = note.snippet ?? (note.preview || t('notes.noText'));
    // Notes from a subfolder name their folder first; root notes show nothing extra.
    const folder = folderOf(note.fileName);
    const description = folder ? t('notes.inFolder', { folder, text }) : text;
    // The date shown is the one the list is sorted and grouped by.
    const time = formatModified(this.sort === 'created' && !this.searchHits ? createdTime(note) : note.modified);
    return el('ui5-li', {
      // UI5 renders the icon as decorative, so a pinned entry also says so in its accessible name.
      icon: note.pinned ? 'pushpin-on' : 'document-text',
      description,
      additionalText: time,
      tooltip: note.fileName,
      navigated: note.id === this.currentId,
      ...(note.pinned ? { accessibleName: t('notes.pinnedItem', { title: note.title, description, time }) } : {}),
      'data-id': note.id,
    }, [note.title]);
  }

  /** All entries of the note list, also those inside date groups. */
  private listItems(): Ui5Element[] {
    return [...this.els.notesList.querySelectorAll<Ui5Element>('ui5-li')];
  }

  /** Marks the current note without rebuilding the list (keeps focus). */
  private updateSelection(): void {
    for (const item of this.listItems()) {
      item.navigated = item.dataset.id ? item.dataset.id === this.currentId : item.dataset.trash === this.currentTrash;
    }
  }

  // -------------------------------------------------------------------------
  // Pinning and sorting
  // -------------------------------------------------------------------------

  private currentNote(): NoteSummary | undefined {
    return this.currentId ? this.notes.find((n) => n.id === this.currentId) : undefined;
  }

  /** The note entry an event came from (the event target is retargeted, so walk the composed path). */
  private noteItemFrom(event: Event): Ui5Element | null {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.localName === 'ui5-li' && node.dataset.id) return node as Ui5Element;
      if (node === this.els.notesList) break;
    }
    return null;
  }

  private openNoteContextMenu(item: Ui5Element): void {
    const note = this.notes.find((n) => n.id === item.dataset.id);
    if (!note) return;
    this.contextNoteId = note.id;
    this.pendingContextPin = false;
    this.updatePinItem(this.els.contextPinItem, note.pinned);
    this.els.noteContextMenu.headerText = note.title;
    this.els.noteContextMenu.opener = item;
    this.els.noteContextMenu.open = true;
  }

  private updatePinItem(item: Ui5Element, pinned: boolean): void {
    item.text = t(pinned ? 'notes.unpin' : 'notes.pin');
    item.icon = pinned ? 'pushpin-off' : 'pushpin-on';
  }

  private async setPinned(id: string, pinned: boolean, options: { focusListItem?: boolean } = {}): Promise<void> {
    try {
      const summary = await this.api.setPinned(id, pinned);
      const note = this.notes.find((n) => n.id === id);
      if (note) Object.assign(note, summary);
      this.renderList();
      if (options.focusListItem) {
        // A new entry inside a new ui5-li-group is only focusable once the group has rendered its slot.
        await renderFinished();
        this.listItems().find((item) => item.dataset.id === id)?.focus();
      }
      announce(t(pinned ? 'announce.pinned' : 'announce.unpinned', { title: summary.title }));
    } catch (err) {
      this.showError(t('error.pin'), err);
    }
  }

  private updateSortUi(): void {
    for (const item of this.els.sortMenu.querySelectorAll<Ui5Element>('ui5-menu-item')) item.checked = item.dataset.sort === this.sort;
    const label = t('notes.sortCurrent', { order: t(`sort.${this.sort}`) });
    this.els.sortButton.tooltip = label;
    this.els.sortButton.accessibleName = label;
  }

  private async changeSort(sort: NoteSort): Promise<void> {
    if (sort === this.sort) return;
    this.sort = sort;
    this.updateSortUi();
    this.renderList();
    announce(t('announce.sorted', { order: t(`sort.${sort}`) }), { toast: false });
    try {
      await this.api.setNoteSort(sort);
    } catch (err) {
      this.showError(t('error.sort'), err);
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
    if (result.id === this.currentId) this.setFileName(updated.fileName);
  }

  /** The file name is not shown in the header; it is only kept for "Copy file name". */
  private setFileName(name: string): void {
    this.fileName = name;
  }

  private showView(view: 'editor' | 'trashEntry' | 'noSelection' | 'noWorkspace'): void {
    this.currentView = view;
    this.updateFormatUi();
    const editing = view === 'editor' || view === 'trashEntry';
    this.els.editorArea.hidden = !editing;
    this.els.viewModeButton.hidden = !editing;
    this.els.noSelection.hidden = view !== 'noSelection';
    this.els.noWorkspace.hidden = view !== 'noWorkspace';
    this.els.noteActions.hidden = view !== 'editor';
    this.els.labelRow.hidden = view !== 'editor';
    if (view !== 'editor') this.els.backlinksRegion.hidden = true;
    this.els.trashActions.hidden = view !== 'trashEntry';
    if (!editing) {
      this.setFileName('');
      this.els.saveStatus.textContent = '';
      this.els.textCount.hidden = true;
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
      this.loadDoc(doc.body);
      this.setFileName(doc.fileName);
      this.setStatus(t('status.modifiedAt', { time: formatModified(doc.modified) }));
      this.renderTokens(doc.labels);
      this.showView('editor');
      this.setLayout('ThreeColumnsEndExpanded');
      this.updateSelection();
      void this.refreshBacklinks(id);
    } catch (err) {
      this.showError(t('error.openNote'), err);
    }
  }

  /** Fills "Linked from" with the notes whose text links to note `id`. */
  private async refreshBacklinks(id: string): Promise<void> {
    const list = this.els.backlinksList;
    list.replaceChildren();
    this.els.backlinksRegion.hidden = true;
    try {
      // The full-text search narrows the candidates; the body check makes sure it is a real link.
      const hits = (await this.api.searchNotes(id)).filter((hit) => hit.id !== id);
      const linking: NoteSummary[] = [];
      for (const hit of hits) {
        const note = this.notes.find((n) => n.id === hit.id);
        if (note && linksTo((await this.api.readNote(hit.id)).body, id)) linking.push(note);
      }
      // The user may have opened another note meanwhile.
      if (this.currentId !== id) return;
      list.replaceChildren(
        ...linking.map((note) => el('ui5-li', { icon: 'chain-link', tooltip: note.fileName, 'data-id': note.id }, [note.title])),
      );
      this.els.backlinksRegion.hidden = linking.length === 0;
    } catch {
      // The list is a convenience; a failed lookup just leaves it empty.
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
      this.loadDoc(doc.body);
      this.setFileName(doc.fileName);
      this.setStatus(t('status.created'));
      this.renderTokens([]);
      // A new note is written, not read: leave preview-only mode.
      if (this.viewMode === 'preview') this.setViewMode('edit');
      this.showView('editor');
      this.setLayout('ThreeColumnsEndExpanded');
      this.editor?.focus();
    } catch (err) {
      this.showError(t('error.createNote'), err);
    }
  }

  private onEditorChange(doc: string): void {
    this.updateCount(doc);
    if (!this.currentId) return;
    this.dirty = true;
    this.scheduleRecovery();
    this.schedulePreview();
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
          this.setStatus(t('status.savedAt', { time: formatTime(result.modified) }), true);
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

  private async saveAttachments(files: File[]): Promise<Array<{ name: string; path: string }>> {
    const saved: Array<{ name: string; path: string }> = [];
    for (const file of files) {
      if (!isAllowedAttachment(file.name)) {
        this.showError(t('error.attachmentType', { name: file.name }), file.name);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.showError(t('error.attachmentSize', { name: file.name }), file.size);
        continue;
      }
      try {
        saved.push({ name: file.name, path: await this.api.saveAttachment(new Uint8Array(await file.arrayBuffer()), file.name) });
      } catch (err) {
        this.showError(t('error.attachmentSave', { name: file.name }), err);
      }
    }
    if (saved.length > 0) announce(tp('announce.attached', saved.length));
    return saved;
  }

  private async openAttachment(src: string): Promise<void> {
    try {
      await this.api.openAttachment(src);
    } catch (err) {
      this.showError(t('error.attachmentOpen'), err);
    }
  }

  private async revealAttachment(src: string): Promise<void> {
    try {
      await this.api.revealAttachment(src);
    } catch (err) {
      this.showError(t('error.attachmentOpen'), err);
    }
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
      const trashName = await this.api.trashNote(id);
      this.notes = this.notes.filter((n) => n.id !== id);
      this.closeEditor();
      this.renderLibrary();
      this.renderList();
      // The live region announces; the strip with its button replaces the toast.
      announce(t('announce.trashed', { title }), { toast: false });
      this.showUndo(t('announce.trashed', { title }), trashName);
    } catch (err) {
      this.showError(t('error.trash'), err);
    }
  }

  /** Shows a strip with an "Undo" button for a few seconds after a note was moved to the trash. */
  private showUndo(text: string, trashName: string): void {
    window.clearTimeout(this.undoTimer);
    const button = el('ui5-button', { design: 'Transparent' }, [t('trash.undo')]);
    const strip = el('ui5-message-strip', { design: 'Information', hideCloseButton: true }, [
      el('span', {}, [text]),
      el('div', { className: 'notice-actions' }, [button]),
    ]);
    const dismiss = () => {
      window.clearTimeout(this.undoTimer);
      strip.remove();
    };
    button.addEventListener('click', () => {
      dismiss();
      void this.undoTrash(trashName);
    });
    this.els.undoRegion.replaceChildren(strip);
    this.undoTimer = window.setTimeout(dismiss, UNDO_VISIBLE_MS);
  }

  private async undoTrash(trashName: string): Promise<void> {
    try {
      const summary = await this.api.restoreFromTrash(trashName);
      this.notes = await this.api.listNotes();
      this.trash = await this.api.listTrash();
      await this.setView({ kind: 'all' });
      announce(t('announce.restored', { title: summary.title }));
      await this.openNote(summary.id);
    } catch (err) {
      this.showError(t('error.restore'), err);
    }
  }

  private async openTrashEntry(trashName: string): Promise<void> {
    try {
      const body = await this.api.readTrash(trashName);
      const entry = this.trash.find((t) => t.trashName === trashName);
      this.closeEditor();
      this.currentTrash = trashName;
      this.loadDoc(body, { readOnly: true });
      this.setFileName(entry?.title ?? '');
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

  private async duplicateCurrent(): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    // The copy must contain the latest text.
    await this.flush();
    try {
      const doc = await this.api.duplicateNote(id);
      this.notes = await this.api.listNotes();
      this.renderLibrary();
      this.renderList();
      await this.openNote(doc.id);
      announce(t('announce.duplicated'));
    } catch (err) {
      this.showError(t('error.duplicate'), err);
    }
  }

  private async copyFileName(): Promise<void> {
    if (!this.currentId) return;
    // The name follows the title only after a pause; settle a pending rename first.
    await this.flush();
    if (!this.fileName) return;
    try {
      await navigator.clipboard.writeText(this.fileName);
      announce(t('announce.fileNameCopied'));
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
    this.loadDoc(doc.body);
    view.dispatch({ selection: { anchor: head } });
    this.dirty = false;
    this.setFileName(doc.fileName);
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
        this.loadDoc(doc.body);
        this.dirty = false;
        this.applySaveResult(doc);
        this.setStatus(t('status.savedAt', { time: formatTime(doc.modified) }), true);
        announce(t('announce.versionRestored'));
      }
    } catch (err) {
      this.showError(t('error.versions'), err);
    }
  }

  /** Shows the headings of the open note and jumps to the chosen one. */
  private async openOutline(): Promise<void> {
    if (isOutlineDialogOpen() || !this.editor || this.currentView !== 'editor') return;
    try {
      const entries = extractOutline(this.editor.getDoc());
      const entry = await openOutlineDialog(entries);
      if (entry) this.jumpToHeading(entry, entries);
    } catch (err) {
      this.showError(t('error.outline'), err);
    }
  }

  private jumpToHeading(entry: OutlineEntry, entries: OutlineEntry[]): void {
    const view = this.editor?.view;
    if (!view) return;
    if (this.viewMode === 'preview') {
      // Only the rendered preview is visible. Match by text (and the n-th repeat of it), so headings
      // the outline does not list, such as setext ones, cannot shift the position.
      const repeat = entries.filter((e) => e.text === entry.text).indexOf(entry);
      const target = [...this.els.previewPane.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.textContent?.trim() === entry.text)[repeat];
      target?.scrollIntoView({ block: 'start' });
      (target as HTMLElement | undefined)?.setAttribute('tabindex', '-1');
      (target as HTMLElement | undefined)?.focus({ preventScroll: true });
    } else {
      const pos = Math.min(entry.offset, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 8 }) });
      view.focus();
    }
    announce(t('announce.outlineJump', { title: entry.text }), { toast: false });
  }

  private async openShortcuts(): Promise<void> {
    if (isShortcutsDialogOpen()) return;
    try {
      await openShortcutsDialog();
    } catch (err) {
      this.showError(t('error.shortcutsDialog'), err);
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
    // Compare with the name the store will actually keep (trimmed, shortened).
    const [target] = normalizeLabels([to ?? '']);
    if (to === null || !target || target === from) return;
    try {
      const changed = await this.api.renameLabel(from, to);
      this.notes = await this.api.listNotes();
      const renamed = changed[0]?.labels.find((l) => sameLabel(l, target)) ?? target;
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

  private setStatus(text: string, fade = false): void {
    // Only set on a real change, otherwise screen readers announce it twice.
    if (this.els.saveStatus.textContent !== text) this.els.saveStatus.textContent = text;
    // After a successful save the status fades to a calmer colour. The text stays,
    // so the live region is not touched. Every other status is shown at full strength.
    window.clearTimeout(this.statusFadeTimer);
    this.els.saveStatus.classList.remove('save-status--idle');
    if (fade) {
      this.statusFadeTimer = window.setTimeout(() => this.els.saveStatus.classList.add('save-status--idle'), STATUS_FADE_MS);
    }
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

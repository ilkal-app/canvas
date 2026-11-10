import type { MenuEntry, MenuItemEntry } from '../controls/menu.js';
import type { ThemePreference } from '../theme/theme-preference.js';

import type { HelpLinks } from './help-links.js';

/**
 * What a host (the site's board page) lets the floating board menu do, each an action
 * of its own; an absent one hides its item, which is how the host gates the menu by role (only an
 * owner renames or deletes; a viewer has no Board settings).
 */
export interface FloatingBoardMenuHost {
  /** Starts renaming the board in place, in the board bar. */
  readonly onRename?: () => void;
  /** Duplicates the board and opens the copy in a new tab. */
  readonly onDuplicate?: () => void;
  /** Opens the board's version history. */
  readonly onVersionHistory?: () => void;
  /** Opens the share dialog: the people, their roles and the link. */
  readonly onShare?: () => void;
  /** Opens the board settings dialog. */
  readonly onBoardSettings?: () => void;
  /** Asks to move the board to the trash (a confirmation first). */
  readonly onDelete?: () => void;
}

/** What {@link floatingBoardMenuEntries} builds the menu from. */
export interface FloatingBoardMenuInput {
  /** The host's actions; none outside a site (the harness) or once the session ended. */
  readonly host: FloatingBoardMenuHost | undefined;
  /** Goes to all boards; no All boards if absent. */
  readonly onNavigateHome: (() => void) | undefined;
  /** The person's theme preference. */
  readonly themePreference: ThemePreference;
  /** Changes it. */
  readonly onThemeChange: (preference: ThemePreference) => void;
  /** Opens the keyboard shortcut sheet. */
  readonly onKeyboardShortcuts: () => void;
  /**
   * Opens an address: the help page in a new tab, the feedback `mailto:` in place.
   *
   * @param url - The address.
   * @param isNewTab - Whether to open it in a new tab.
   */
  readonly openUrl: (url: string, isNewTab: boolean) => void;
  /**
   * Whether the bar is the phone's compact one, whose menu holds Search board after
   * All boards; false if absent.
   */
  readonly isCompact?: boolean | undefined;
  /** Opens the board's search sheet; the compact menu's Search board. */
  readonly onSearch?: (() => void) | undefined;
  /**
   * The board's comments: whether resolved threads' pins show, and their toggle, the
   * menu's "Show resolved comments"; none on a board without site comments. `'pending'` while
   * they are on their way (the board not connected yet): their row is kept, disabled.
   */
  readonly comments?: FloatingMenuComments | 'pending' | undefined;
  /**
   * The board's export: what it exports, the page shown (`board`) or the selection,
   * and how; no Export item if absent. `'pending'` while it is on its way (the engine not
   * mounted yet): its row is kept, disabled.
   */
  readonly export?: FloatingBoardExport | 'pending' | undefined;
  /** The board's pages: on a phone's compact bar, Pages; none if absent. */
  readonly pages?: FloatingMenuPages | undefined;
  /** Where Help and feedback goes: the host's links; no Help and feedback if absent. */
  readonly help?: HelpLinks | undefined;
}

/** What the floating board menu's page item does. */
export interface FloatingMenuPages {
  /** Opens the page list; no Pages item if absent (one page, or a bar with the chip). */
  readonly onOpen: (() => void) | undefined;
  /** How many pages the board has, Pages' meta. */
  readonly count: number;
}

/** What the floating board menu's Export does. */
export interface FloatingBoardExport {
  /** Whether it exports the page shown or the selection. */
  readonly scope: 'board' | 'selection';
  /**
   * Exports.
   *
   * @param format - The file's format.
   * @param scale - Device px per board unit (a PDF's pages are drawn at 2× where they fit).
   */
  readonly onExport: (format: 'png' | 'pdf', scale: 1 | 2) => void;
}

/**
 * The Export item and its submenu (design frame C: "Export", "PNG, PDF ›"): PNG at 1×
 * and at 2×, and PDF (a page per section), each saying what it exports.
 *
 * @param exported - The export, if the shell offers one; `'pending'` while on its way, its row
 *   kept, disabled.
 * @returns The item, or nothing.
 */
export function exportEntriesOf(
  exported: FloatingBoardExport | 'pending' | undefined,
): MenuItemEntry[] {
  if (exported === undefined) return [];
  // On its way: the row in its place, so nothing moves when it is ready.
  if (exported === 'pending')
    return [{ kind: 'item', id: 'export', label: 'Export', meta: 'PNG, PDF', isDisabled: true }];
  const meta = exported.scope === 'board' ? 'Board' : 'Selection';
  const scales: readonly (1 | 2)[] = [1, 2];
  return [
    {
      kind: 'item',
      id: 'export',
      label: 'Export',
      meta: 'PNG, PDF',
      submenu: [
        ...scales.map((scale) => ({
          kind: 'item' as const,
          id: `export-png-${String(scale)}`,
          label: `PNG ${String(scale)}×`,
          meta,
          onSelect: () => {
            exported.onExport('png', scale);
          },
        })),
        {
          kind: 'item',
          id: 'export-pdf',
          label: 'PDF',
          meta,
          onSelect: () => {
            exported.onExport('pdf', 2);
          },
        },
      ],
    },
  ];
}

/** The board's comments as the floating board menu shows them. */
export interface FloatingMenuComments {
  /** Whether resolved threads' pins show. */
  readonly isResolvedShown: boolean;
  /** Shows or hides them. */
  readonly onToggleResolved: () => void;
  /** How many open threads are unread for the person, and how many mention them. */
  readonly unread?: { readonly threads: number; readonly mentions: number } | undefined;
  /** Goes to the next unread thread, a mention first, and opens it. */
  readonly onOpenUnread?: (() => void) | undefined;
}

/** The toggle of resolved threads' pins, as the menu names it. */
const RESOLVED_TOGGLE = {
  kind: 'checkbox',
  id: 'show-resolved-comments',
  label: 'Show resolved comments',
} as const;

/** Each theme choice, with the name the menu gives it. */
const THEME_CHOICES: readonly (readonly [ThemePreference, string])[] = [
  ['system', 'System'],
  ['light', 'Light (Vellum)'],
  ['dark', 'Dark (Graphite)'],
];

/**
 * An item when its action exists.
 *
 * @param id - The item's id.
 * @param label - Its words.
 * @param onSelect - Its action, if the host gives one.
 * @returns The item, or nothing.
 */
function itemOf(id: string, label: string, onSelect: (() => void) | undefined): MenuItemEntry[] {
  return onSelect === undefined ? [] : [{ kind: 'item', id, label, onSelect }];
}

/**
 * Help and feedback, when the host gives somewhere for it to go: its submenu holds the
 * help page, opened in a new tab, and the feedback address, opened in place.
 *
 * @param input - The host's links and how to open an address.
 * @returns The item, or nothing when the host gives no link.
 */
function helpEntriesOf(input: FloatingBoardMenuInput): MenuItemEntry[] {
  const { help } = input;
  const docsUrl = help?.docsUrl;
  const feedbackUrl = help?.feedbackUrl;
  const submenu = [
    ...itemOf(
      'help-docs',
      'Help centre',
      docsUrl === undefined
        ? undefined
        : () => {
            input.openUrl(docsUrl, true);
          },
    ),
    ...itemOf(
      'help-feedback',
      'Send feedback',
      feedbackUrl === undefined
        ? undefined
        : () => {
            input.openUrl(feedbackUrl, false);
          },
    ),
  ];
  return submenu.length === 0
    ? []
    : [{ kind: 'item', id: 'help', label: 'Help and feedback', submenu }];
}

/**
 * The menu's first group: All boards, and on a phone's compact bar Search board after it.
 *
 * @param input - The way home, whether the bar is compact and how to open search.
 * @returns The items.
 */
function homeGroup(input: FloatingBoardMenuInput): readonly MenuItemEntry[] {
  return [
    ...itemOf('all-boards', 'All boards', input.onNavigateHome),
    ...(input.isCompact === true ? itemOf('search', 'Search board', input.onSearch) : []),
  ];
}

/**
 * The menu's comment entries: with no threads panel under the floating chrome, the
 * unread threads' count ("3", or "3 · \@1" with mentions), which goes to the next
 * one, while any is unread; then the toggle of resolved threads' pins, checked while they show.
 *
 * @param comments - The board's comments, if it has site comments; `'pending'` while on their way,
 *   the toggle's row kept, disabled. The unread row joins once they are ready: its count
 *   can't be known before.
 * @returns The entries, none without comments.
 */
function commentEntriesOf(comments: FloatingBoardMenuInput['comments']): MenuItemEntry[] {
  if (comments === undefined) return [];
  // On their way: the toggle's row in its place, so nothing moves when they are ready.
  if (comments === 'pending') return [{ ...RESOLVED_TOGGLE, isChecked: false, isDisabled: true }];
  const { unread, onOpenUnread } = comments;
  const unreadEntries: MenuItemEntry[] =
    unread === undefined || unread.threads === 0 || onOpenUnread === undefined
      ? []
      : [
          {
            kind: 'item',
            id: 'unread-comments',
            label: unread.mentions > 0 ? 'Unread comments and mentions' : 'Unread comments',
            meta:
              unread.mentions > 0
                ? `${String(unread.threads)} · @${String(unread.mentions)}`
                : String(unread.threads),
            onSelect: onOpenUnread,
          },
        ];
  return [
    ...unreadEntries,
    {
      ...RESOLVED_TOGGLE,
      isChecked: comments.isResolvedShown,
      onSelect: comments.onToggleResolved,
    },
  ];
}

/**
 * The menu's page item: Pages, which opens the list (on a phone's compact bar, from two
 * pages on, its meta the count). Add page is the bar's last control, not an item.
 *
 * @param pages - The board's pages, if the shell offers them.
 * @returns The items.
 */
function pageEntriesOf(pages: FloatingMenuPages | undefined): MenuItemEntry[] {
  if (pages?.onOpen === undefined) return [];
  return [
    {
      kind: 'item',
      id: 'pages',
      label: 'Pages',
      meta: String(pages.count),
      onSelect: pages.onOpen,
    },
  ];
}

/**
 * The menu's board group (design frame C): Rename, Duplicate board, Export and Version
 * history, each where it is offered.
 *
 * @param input - The host's actions and the export.
 * @returns The items, in order.
 */
function boardGroupOf(input: FloatingBoardMenuInput): MenuItemEntry[] {
  const { host } = input;
  return [
    ...itemOf('rename', 'Rename', host?.onRename),
    ...itemOf('duplicate', 'Duplicate board', host?.onDuplicate),
    ...exportEntriesOf(input.export),
    ...itemOf('version-history', 'Version history', host?.onVersionHistory),
  ];
}

/**
 * The floating board menu's entries (design frame C): All boards; Rename and Version
 * history, with Duplicate board between them; Unread comments and Show resolved
 * comments (on a board with site comments); Share and permissions, Board settings, Theme (its choices in a
 * submenu), Keyboard shortcuts and Help and feedback (the host's help page and feedback address
 * in a submenu, `help`); Delete board as a danger item. An item the host does not give is left
 * out, and so is a separator with nothing on one side. Export follows Duplicate board
 * when the shell offers it (PNG at 1× and 2×, PDF). Not offered: Grid, Snapping and
 * the Comments panel (their shortcuts stay). On a phone's compact bar, Search board follows All
 * boards, the bar having no room for its button. The page item is a group
 * of its own after it: Pages, the compact bar's way to the list. All boards and
 * Version history carry no shortcut hint until those keys exist. Pure.
 *
 * @param input - The host's actions, the way home, the theme, the shortcut sheet, how to open
 *   an address and the board's comments.
 * @returns The entries, in order.
 */
export function floatingBoardMenuEntries(input: FloatingBoardMenuInput): readonly MenuEntry[] {
  const { host } = input;
  const current = THEME_CHOICES.find(([preference]) => preference === input.themePreference);
  const groups: readonly (readonly MenuItemEntry[])[] = [
    homeGroup(input),
    pageEntriesOf(input.pages),
    boardGroupOf(input),
    commentEntriesOf(input.comments),
    [
      ...itemOf('share', 'Share and permissions', host?.onShare),
      ...itemOf('board-settings', 'Board settings', host?.onBoardSettings),
      {
        kind: 'item',
        id: 'theme',
        label: 'Theme',
        ...(current === undefined ? {} : { meta: current[1] }),
        submenu: THEME_CHOICES.map(([preference, label]) => ({
          kind: 'radio' as const,
          id: `theme-${preference}`,
          label,
          isChecked: preference === input.themePreference,
          onSelect: () => {
            input.onThemeChange(preference);
          },
        })),
      },
      {
        kind: 'item',
        id: 'keyboard-shortcuts',
        label: 'Keyboard shortcuts',
        meta: '?',
        onSelect: input.onKeyboardShortcuts,
      },
      ...helpEntriesOf(input),
    ],
    host?.onDelete === undefined
      ? []
      : [
          {
            kind: 'item',
            id: 'delete',
            label: 'Delete board',
            isDanger: true,
            onSelect: host.onDelete,
          },
        ],
  ];
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index): MenuEntry[] =>
      index === 0
        ? [...group]
        : [{ kind: 'separator', id: `separator-${String(index)}` }, ...group],
    );
}

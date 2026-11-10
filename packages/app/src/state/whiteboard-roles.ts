import type { FloatingDockToolId } from './floating-dock.js';

// What a person who cannot edit sees on a floating whiteboard (the owner's role table
// of 2026-10-20, as written): their dock, their properties popover, their vote and their board
// menu. The editor's and the owner's shells are the whole chrome.

/** What the board menu offers a role beyond the owner's own items. */
export type WhiteboardMenuItem = 'allBoards' | 'theme' | 'shortcuts' | 'boardSettings';

/** One role's whiteboard shell. */
export interface WhiteboardRoleShell {
  /** The dock's tools (`FLOATING_READ_ONLY_TOOLS`). */
  readonly dockTools: readonly FloatingDockToolId[];
  /** The properties popover at a selection: none, or Comment alone. */
  readonly popover: 'none' | 'comment';
  /** Whether the person may vote in a dot vote: never (of 2026-10-20). */
  readonly canVote: false;
  /**
   * The board menu: All boards, Theme and Keyboard shortcuts, and Board settings (read-only for
   * the board, holding the person's own Grid and Snapping:'s ruling of 2026-10-21, after
   * the table). Export comes with and Help with its targets; no Version history, Share,
   * Rename or Delete.
   */
  readonly menu: readonly WhiteboardMenuItem[];
}

/** The menu a person who cannot edit gets. */
const READ_ONLY_MENU: readonly WhiteboardMenuItem[] = [
  'allBoards',
  'theme',
  'shortcuts',
  'boardSettings',
];

/** Each role's shell: a viewer looks and pans; a commenter also comments and reacts. */
export const WHITEBOARD_ROLE_SHELL: Readonly<Record<'viewer' | 'commenter', WhiteboardRoleShell>> =
  {
    viewer: { dockTools: ['select', 'pan'], popover: 'none', canVote: false, menu: READ_ONLY_MENU },
    commenter: {
      dockTools: ['select', 'pan', 'comment', 'reactions'],
      popover: 'comment',
      canVote: false,
      menu: READ_ONLY_MENU,
    },
  };

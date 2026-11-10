import type { ReactElement, ReactNode } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import { BoardNotices } from '../collab/board-notices.js';
import { ContextMenu } from '../context-menu/context-menu.js';
import type { ContextMenuState } from '../context-menu/use-context-menu.js';
import { ShortcutCheatSheet } from '../dialogs/shortcut-cheat-sheet.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { useIsFloatingDock } from './use-floating-dock.js';

/** What {@link ShellLayers} shows and where its choices go. */
export interface ShellLayersProps {
  /** The board's connection, whose notices show over the canvas; none if absent. */
  readonly connection: BoardConnection | undefined;
  /** The board's name for the stranded-edits notice; the board id if absent. */
  readonly boardName: string | undefined;
  /** Whether the person may edit the board, for the view-only notice. */
  readonly canEdit: boolean;
  /** The host's own notice, first among the board's notices; none if absent. */
  readonly hostNotice?: ReactNode;
  /** The canvas's context menu, if open (`useContextMenu`). */
  readonly contextMenu: ContextMenuState['contextMenu'];
  /** Whether the shortcut cheat sheet is open. */
  readonly isCheatSheetOpen: boolean;
  /** The shell's shortcuts, which the cheat sheet lists (the menu shows their chords). */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Runs a shell action: a menu entry, or closing the cheat sheet. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The layers over the whole shell: the board's notices (that the person can only view it,
 * edits a layout bump stranded), with a board connection, outside the layout
 * so they stay live while an outdated app's layout is inert, then, when open, the
 * canvas's context menu and the shortcut cheat sheet. The connection's
 * state shows in the presence/share bar (`ShellTopBars`).
 *
 * @param props - The connection, what is open, the shortcuts and the dispatch.
 * @returns The layers.
 */
export function ShellLayers(props: ShellLayersProps): ReactElement {
  const { connection, boardName, canEdit, contextMenu, isCheatSheetOpen, registry, dispatch } =
    props;
  // A floating whiteboard's sheet lists the whiteboard's shortcuts.
  const isFloatingDock = useIsFloatingDock();
  return (
    <>
      {connection !== undefined && (
        <BoardNotices
          connection={connection}
          boardName={boardName}
          canEdit={canEdit}
          hostNotice={props.hostNotice}
          onReplaceMissingFont={(family) => {
            dispatch({ type: 'replaceMissingFont', family });
          }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          key={contextMenu.sequence}
          {...contextMenu}
          platform={registry.platform}
          onChoose={dispatch}
        />
      )}
      {isCheatSheetOpen && (
        <ShortcutCheatSheet
          registry={registry}
          layout={isFloatingDock ? 'whiteboard' : 'classic'}
          onClose={() => {
            dispatch({ type: 'closeCheatSheet' });
          }}
        />
      )}
    </>
  );
}

import type { ShellAction } from '../../state/shell-action.js';

import type { LayerRowItemProps } from './layer-row-item.js';
import type { LayerRow } from './layer-rows.js';

/**
 * A row's lock toggle: locks or unlocks that row's object alone (`toggleLockOf`).
 *
 * @param dispatch - The shell's dispatch.
 * @returns The toggle.
 */
function toggleLockOf(dispatch: (action: ShellAction) => void): (row: LayerRow) => void {
  return (row) => {
    dispatch({ type: 'toggleLockOf', ids: [row.id] });
  };
}

/**
 * A row's visibility toggle: hides that row's object alone, or shows it again by
 * removing its `isHidden`; one `setStyle`, so one undo step.
 *
 * @param dispatch - The shell's dispatch.
 * @returns The toggle.
 */
function toggleHiddenOf(dispatch: (action: ShellAction) => void): (row: LayerRow) => void {
  return (row) => {
    dispatch({
      type: 'style',
      changes: [{ id: row.id, style: { isHidden: row.isHidden ? undefined : true } }],
    });
  };
}

/**
 * An object's name edited in its row (any object's since): one `renameObject`
 * through the shell's rename action, one undo step; an empty name clears it.
 *
 * @param dispatch - The shell's dispatch.
 * @returns The rename.
 */
function renameOf(dispatch: (action: ShellAction) => void): (row: LayerRow, name: string) => void {
  return (row, name) => {
    dispatch({ type: 'component', command: 'rename', id: row.id, name });
  };
}

/**
 * A row's editing handlers: the visibility and lock toggles and the rename, or none for a person who cannot
 * edit.
 *
 * @param canEdit - Whether the person may edit the board.
 * @param dispatch - The shell's dispatch.
 * @returns The handlers to spread onto a row.
 */
export function editingOf(
  canEdit: boolean,
  dispatch: (action: ShellAction) => void,
): Pick<LayerRowItemProps, 'onToggleLock' | 'onToggleHidden' | 'onRename'> {
  return canEdit
    ? {
        onToggleLock: toggleLockOf(dispatch),
        onToggleHidden: toggleHiddenOf(dispatch),
        onRename: renameOf(dispatch),
      }
    : {};
}

import { useEffect } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import { isLoadingLiveBoard } from '../collab/connection-label.js';
import { useCanEdit } from '../collab/use-can-edit.js';
import { useConnectionStatus } from '../collab/use-connection-status.js';
import { useShellState } from '../hooks/use-shell-state.js';

import { useIsMobileSite } from './mobile-site.js';

/**
 * The shell's state (`useShellState`) following whether the person may edit the board:
 * the connection's word (`useCanEdit`, the relay's answer for their token) is the
 * shell's one `canEdit`, which it starts from and is told (`setEditable`) whenever it changes,
 * a role changed mid-session included; the reducer, the engine, the toolbar, the panels, the
 * context menu, the clipboard and the board's notices all read it from the state. Below 768 px
 * wide it is also false while the live board loads (L1: the compact chrome says editing
 * starts when the board is live), so nothing edits the saved copy meanwhile.
 *
 * @param connection - The board's connection; none for the engine's local document.
 * @param isLoading - Whether hydration still blocks input.
 * @returns The state, the dispatch, and whether role and hydration let them edit (the notices'
 *   word: an editor refused only by L1 is not told they can only view).
 */
export function useEditableShellState(connection: BoardConnection | undefined, isLoading: boolean) {
  const canEditByRole = useCanEdit(connection) && !isLoading;
  const status = useConnectionStatus(connection);
  // Below 768 px wide the compact chrome says editing starts once the live board is in (L1).
  const isLiveRefused = useIsMobileSite() && status !== undefined && isLoadingLiveBoard(status);
  const canEdit = canEditByRole && !isLiveRefused;
  const [state, dispatch] = useShellState(canEdit);
  useEffect(() => {
    dispatch({ type: 'setEditable', canEdit });
  }, [canEdit, dispatch]);
  return [state, dispatch, canEditByRole] as const;
}

import { useCallback, useSyncExternalStore } from 'react';

import type { ConnectionStatusSource } from './board-connection.js';

/**
 * Whether the person may edit the board, following the connection: not while its
 * status says the board is read-only for them (`BoardConnectionStatus.isReadOnly`: a viewer or
 * a commenter, as the relay last answered). The shell's one source of `canEdit`: its state, the
 * engine, the toolbar, the panels, the context menu and the clipboard all follow it. Main
 * thread.
 *
 * @param connection - The board's connection; none for the engine's own local document, which
 *   is always editable.
 * @returns True unless the connection says the board is read-only.
 */
export function useCanEdit(connection: ConnectionStatusSource | undefined): boolean {
  // One subscription per connection, not one per render (the shell renders on every action).
  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? noUnsubscribe,
    [connection],
  );
  return useSyncExternalStore(subscribe, () => connection?.status().isReadOnly !== true);
}

/** What subscribing to no connection returns. */
function noUnsubscribe(): void {
  // Nothing was subscribed.
}

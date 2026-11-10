import { useSyncExternalStore } from 'react';

import type { ConnectionStatusSource } from './board-connection.js';

/**
 * Whether the board's connection says this build of the app cannot read the board (`outdated`,
 *), following its changes. The shell turns editing off while it is: the relay sends
 * nothing more, and the store may refuse writes. Main thread.
 *
 * @param connection - The board's connection; none for the engine's own local document.
 * @returns True while the connection is outdated.
 */
export function useIsOutdated(connection: ConnectionStatusSource | undefined): boolean {
  return useSyncExternalStore(
    (listener) => connection?.subscribe(listener) ?? noUnsubscribe,
    () => connection?.status().state === 'outdated',
  );
}

/** What subscribing to no connection returns. */
function noUnsubscribe(): void {
  // Nothing was subscribed.
}

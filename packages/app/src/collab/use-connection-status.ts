import { useCallback, useSyncExternalStore } from 'react';

import type { BoardConnectionStatus } from './board-connection-status.js';
import type { ConnectionStatusSource } from './board-connection.js';

/**
 * Where the board's connection stands, following it (`ConnectionStatusSource`): the shell's top
 * bars read it for the live board's loading and the offline banner (Figma
 * X1). One subscription per connection. Main thread.
 *
 * @param connection - The board's connection; none for a shell without one.
 * @returns Its status, or undefined without a connection.
 */
export function useConnectionStatus(
  connection: ConnectionStatusSource | undefined,
): BoardConnectionStatus | undefined {
  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? noUnsubscribe,
    [connection],
  );
  return useSyncExternalStore(subscribe, () => connection?.status());
}

/** What subscribing to no connection returns. */
function noUnsubscribe(): void {
  // Nothing was subscribed.
}

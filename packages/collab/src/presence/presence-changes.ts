import { isPresenceState } from './presence-guard.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceClientId, PresenceState } from './presence-state.js';

/**
 * The cleaned states of the remote clients an awareness change named: `undefined` for
 * one that left or holds no valid presence. The local client is left out.
 *
 * @param clientIds - The changed clients.
 * @param readState - Reads a client's raw awareness state.
 * @param localClientId - The local client, left out.
 * @returns The states by client id.
 */
export function changedStatesOf(
  clientIds: Iterable<PresenceClientId>,
  readState: (clientId: PresenceClientId) => unknown,
  localClientId: PresenceClientId,
): Map<PresenceClientId, PresenceState | undefined> {
  const changed = new Map<PresenceClientId, PresenceState | undefined>();
  for (const clientId of clientIds) {
    if (clientId === localClientId) continue;
    const state = readState(clientId);
    changed.set(clientId, isPresenceState(state) ? sanitizePresenceState(state) : undefined);
  }
  return changed;
}

/**
 * Calls each listener with a value. One that throws does not starve the others: its error is
 * rethrown on its own, where the host's error reporting sees it.
 *
 * @param listeners - The listeners, copied before the first call.
 * @param value - What each receives.
 */
export function callEach<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error: unknown) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

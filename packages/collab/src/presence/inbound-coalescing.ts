import { isPresenceState } from './presence-guard.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceClientId, PresenceSnapshot, PresenceState } from './presence-state.js';

function asIs(state: PresenceState): PresenceState {
  return state;
}

/**
 * Folds the clients that changed since the last snapshot into a new one. Awareness messages
 * arrive one per client per tick (twenty collaborators at 25 Hz is 500 a second); the channel
 * collects the changed ids and calls this once per flush, so consumers see one snapshot per
 * frame, not one per message (collaborator motion).
 *
 * @param previous - The last snapshot; not mutated.
 * @param changed - Clients whose awareness state was added, updated or removed.
 * @param readState - Reads a client's current awareness state (undefined when it has none).
 * @param localClientId - The local client, which never appears in the snapshot.
 * @param show - What of a cleaned state to show (the channel drops an editing claim on an object
 *   the board does not hold); the state as it is if absent. It must return the same
 *   object for the same input while nothing it reads changed, or the snapshot changes needlessly.
 * @returns `previous` itself when no entry changed, otherwise a new snapshot.
 */
export function applyChangedClients(
  previous: PresenceSnapshot,
  changed: Iterable<PresenceClientId>,
  readState: (clientId: PresenceClientId) => unknown,
  localClientId: PresenceClientId,
  show: (state: PresenceState) => PresenceState = asIs,
): PresenceSnapshot {
  let next: Map<PresenceClientId, unknown> | undefined;
  for (const clientId of changed) {
    if (clientId === localClientId) {
      continue;
    }
    const state = readState(clientId);
    const shown = isPresenceState(state) ? show(sanitizePresenceState(state)) : undefined;
    const current = (next ?? previous).get(clientId);
    if (shown === undefined ? current === undefined : current === shown) {
      continue;
    }
    next ??= new Map(previous);
    if (shown !== undefined) {
      next.set(clientId, shown);
    } else {
      next.delete(clientId);
    }
  }
  return (next as PresenceSnapshot | undefined) ?? previous;
}

import { trackOperatedWriters, type PresenceChangeListener } from '@canvas/collab';
import type { OperatedWriters } from '@canvas/document';

import type { BoardConnection } from './board-connection.js';

/** What {@link operatedWritersOf} reads of a board's connection. */
export type OperatedWritersSource = Partial<
  Pick<
    BoardConnection,
    'origin' | 'status' | 'subscribe' | 'remotePresence' | 'subscribePresenceChanges'
  >
>;

/**
 * Which Yjs client ids write for agents the person operates, for their undo history
 * (`createHistory`'s `operatedWriters`): the person presses Cmd+Z, or the undo button, and undoes
 * their agent's change as their own, though the agent writes from another process (the hosted
 * MCP server). `trackOperatedWriters` over the connection's relay-stamped presence: it records
 * while the board is connected, and remembers the ids the relay vouched for after the agent
 * leaves (a hosted MCP session idles out, or resumes as a new client).
 *
 * @param connection - The board's connection.
 * @returns The writers, or `undefined` where there is no presence (a local board) or the person
 *   is not a user (a guest operates no agent).
 */
export function operatedWritersOf(
  connection: OperatedWritersSource | undefined,
): OperatedWriters | undefined {
  const principalId = connection?.origin?.principalId;
  if (principalId?.startsWith('user:') !== true) return undefined;
  const { status, subscribe, remotePresence, subscribePresenceChanges } = connection ?? {};
  if (status === undefined || subscribe === undefined || remotePresence === undefined)
    return undefined;
  return trackOperatedWriters(
    {
      getRemote: () => remotePresence.call(connection),
      subscribe: (listener) => subscribe.call(connection, listener),
      // Each change as it arrives, so a restamp folded with its client leaving is seen.
      ...(subscribePresenceChanges === undefined
        ? {}
        : {
            subscribeChanges: (listener: PresenceChangeListener) =>
              subscribePresenceChanges.call(connection, listener),
          }),
    },
    principalId.slice('user:'.length),
    () => status.call(connection).state === 'connected',
  );
}

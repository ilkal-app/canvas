import { writersOperatedBy } from '@canvas/collab';
import type { OperatedWriters } from '@canvas/document';

import type { BoardConnection } from './board-connection.js';

/** What {@link operatedWritersOf} reads of a board's connection. */
export type OperatedWritersSource = Partial<
  Pick<BoardConnection, 'origin' | 'status' | 'remotePresence'>
>;

/**
 * Which Yjs client ids write for agents the person operates, for their undo history
 * (`createHistory`'s `operatedWriters`): the person presses Cmd+Z, or the undo button, and undoes
 * their agent's change as their own, though the agent writes from another process (the hosted
 * MCP server). Asked at each remote update and each undo, from the relay-stamped presence
 * (`writersOperatedBy`):
 *
 * - `records`: while the board is connected (so the catch-up after (re)connecting, which may hold
 *   what an agent did before, is never a step), an id the relay vouches for one of the person's
 *   present agents now, or the awareness id of a present agent of theirs that the relay has not
 *   stamped yet: its first write arrives before its stamp. Never an id of an agent that left:
 *   another connection may write under it then, and nothing would contest it.
 * - `owns`, for undoing what was recorded: ids the relay vouched for one of the person's agents,
 *   remembered after the agent leaves, and forgotten once the agent, present, no longer lists
 *   one (the relay found it contested). An unstamped present agent's awareness id is not
 *   known either way (`undefined`): an undo of a step under it waits until the relay vouches for
 *   the id, and drops it if the relay vouches it for someone else.
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
  const { status, remotePresence } = connection ?? {};
  if (status === undefined || remotePresence === undefined) return undefined;
  const operatorId = principalId.slice('user:'.length);
  // Each vouched id with its agent's principal id.
  const remembered = new Map<number, string>();
  const current = () => {
    const ids = writersOperatedBy(remotePresence.call(connection), operatorId);
    for (const [id, agent] of ids.vouched) remembered.set(id, agent);
    for (const [id, agent] of remembered) {
      if (ids.agents.has(agent) && !ids.vouched.has(id)) remembered.delete(id);
    }
    return ids;
  };
  return {
    records: (clientId) => {
      if (status.call(connection).state !== 'connected') return false;
      const { vouched, unstamped } = current();
      return vouched.has(clientId) || unstamped.has(clientId);
    },
    owns: (clientId) => {
      const { unstamped } = current();
      if (remembered.has(clientId)) return true;
      // A present agent's awareness id the relay has not stamped yet: not known either way.
      return unstamped.has(clientId) ? undefined : false;
    },
  };
}

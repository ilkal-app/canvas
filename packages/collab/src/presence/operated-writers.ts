import { writerClientIdsOf } from './presence-sanitize.js';
import type { PresenceSnapshot } from './presence-state.js';

/** The Yjs client ids of a user's present agents, as presence shows them ({@link writersOperatedBy}). */
export interface OperatedWriterIds {
  /**
   * The writer ids the relay vouches the user's present agents wrote with, each with
   * the agent's principal id; an id vouched for another present client too is left out.
   */
  readonly vouched: ReadonlyMap<number, string>;
  /**
   * The awareness client ids of the user's present agents whose stamp is still empty: the relay
   * stamps an id only after it applied an update under it, so an agent's first write arrives
   * before its stamp. Not proof: another connection may have written under the id first.
   */
  readonly unstamped: ReadonlySet<number>;
  /** The principal ids of the user's present agents. */
  readonly agents: ReadonlySet<string>;
}

/**
 * The Yjs client ids that write for agents a user operates, from the relay-stamped
 * presence: each present agent whose `principal.operatorId` is the user. The writer ids the
 * relay vouches it wrote with are proof (`vouched`); its awareness client id, while its stamp is
 * empty, is a candidate only (`unstamped`): a collab client writes under its awareness id, but
 * the relay ties only the presence to the connection, not the writes. The user's undo
 * history records a remote update under either, and undoes it only under a vouched one
 * (`createHistory`'s `operatedWriters`).
 *
 * @param presence - Who is present, by awareness client id.
 * @param operatorId - The user's id as tokens carry it: the bare id, without `user:`.
 * @returns The ids.
 */
export function writersOperatedBy(
  presence: PresenceSnapshot,
  operatorId: string,
): OperatedWriterIds {
  const vouched = new Map<number, string>();
  const unstamped = new Set<number>();
  const agents = new Set<string>();
  const others = new Set<number>();
  for (const [clientId, state] of presence) {
    const writers = writerClientIdsOf(state);
    const { principal } = state;
    if (principal.kind !== 'agent' || principal.operatorId !== operatorId) {
      for (const id of writers) others.add(id);
      continue;
    }
    agents.add(principal.id);
    if (writers.length === 0) unstamped.add(clientId);
    for (const id of writers) vouched.set(id, principal.id);
  }
  for (const id of others) vouched.delete(id);
  return { vouched, unstamped, agents };
}

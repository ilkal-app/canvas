import type { OperatedWriters } from '@canvas/document';

import type { PresenceChangeListener } from './presence-channel.js';
import { writerClientIdsOf } from './presence-sanitize.js';
import type { PresenceSnapshot, PresenceState } from './presence-state.js';

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

/** Where {@link trackOperatedWriters} reads presence: a client's `PresenceChannel` fits. */
export interface OperatedPresenceSource {
  /**
   * Who is present now, by awareness client id.
   *
   * @returns The snapshot.
   */
  getRemote(): PresenceSnapshot;
  /**
   * Calls `listener` whenever presence changed.
   *
   * @param listener - Called after each change.
   * @returns A function that unsubscribes it.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Calls `listener` with each awareness change as it arrives, before a flush folds it in
   * (`PresenceChannel.subscribeChanges`). Without it, a stamp that drops an id and its
   * holder leaving, folded into one flush, go unseen.
   *
   * @param listener - Receives the changed clients' states.
   * @returns A function that unsubscribes it.
   */
  subscribeChanges?(listener: PresenceChangeListener): () => void;
}

/** A vouched writer id a user's history remembers, and whose presence listed it. */
interface RememberedWriter {
  /** The agent's principal id. */
  readonly agent: string;
  /** The awareness client id whose stamp listed the id. */
  readonly holder: number;
}

/**
 * Whether a presence state is one of the user's agents.
 *
 * @param state - The state.
 * @param operatorId - The user's bare id.
 * @returns True for an agent the user operates.
 */
function isOperatedBy(state: PresenceState, operatorId: string): boolean {
  return state.principal.kind === 'agent' && state.principal.operatorId === operatorId;
}

/**
 * Forgets the remembered ids one awareness change drops: its holder, present, no longer
 * lists it or is someone else now, or a client not of the user's agents lists it. A departure
 * forgets nothing: its last stamp stands.
 *
 * @param remembered - The remembered ids, changed in place.
 * @param changed - The changed clients' states, `undefined` for one that left.
 * @param operatorId - The user's bare id.
 * @returns Whether a changed client is one of the user's agents, whose stamp may be remembered.
 */
function forgetDropped(
  remembered: Map<number, RememberedWriter>,
  changed: ReadonlyMap<number, PresenceState | undefined>,
  operatorId: string,
): boolean {
  let hasAgent = false;
  for (const [clientId, state] of changed) {
    if (state === undefined) continue;
    const isOperated = isOperatedBy(state, operatorId);
    hasAgent ||= isOperated;
    const listed = writerClientIdsOf(state);
    for (const [id, { agent, holder }] of remembered) {
      const isDropped =
        holder === clientId
          ? state.principal.id !== agent || !listed.includes(id)
          : listed.includes(id) && !isOperated;
      if (isDropped) remembered.delete(id);
    }
  }
  return hasAgent;
}

/**
 * Remembers each vouched id with the client that lists it.
 *
 * @param snapshot - Who is present.
 * @param vouched - The ids the relay vouches for the user's agents.
 * @param remembered - The remembered ids, changed in place.
 * @returns Every id any present client lists, gathered once.
 */
function rememberVouched(
  snapshot: PresenceSnapshot,
  vouched: ReadonlyMap<number, string>,
  remembered: Map<number, RememberedWriter>,
): Set<number> {
  const listedAnywhere = new Set<number>();
  for (const [clientId, state] of snapshot) {
    for (const id of writerClientIdsOf(state)) {
      listedAnywhere.add(id);
      const agent = vouched.get(id);
      if (agent !== undefined) remembered.set(id, { agent, holder: clientId });
    }
  }
  return listedAnywhere;
}

/**
 * Which Yjs client ids write for agents a user operates, for their undo
 * history (`createHistory`'s `operatedWriters`), from the relay-stamped presence
 * ({@link writersOperatedBy}):
 *
 * - `records`: while `isConnected` (so the catch-up after (re)connecting, which may hold what an
 *   agent did before, is never a step), an id the relay vouches for one of the user's present
 *   agents now, or the awareness id of a present agent of theirs that the relay has not stamped
 *   yet: its first write arrives before its stamp. Never an id of an agent that left: another
 *   connection may write under it then, and nothing would contest it.
 * - `owns`, for undoing what was recorded: ids the relay vouched for one of the user's agents,
 *   remembered after the agent leaves. The relay stamps an id only after the write, so while a
 *   recorded id waits for its stamp the tracker watches presence and remembers the stamp as it
 *   arrives: the agent may leave before the user's first undo (a hosted MCP session idles out,
 *   its server restarts, or its pooled client is hidden). An id is forgotten once the presence
 *   that listed it, present, no longer lists it (the relay found it contested, which
 *   may leave the stamp empty; a relay restart empties it too, and is not told apart), or once
 *   the relay vouches it for someone else. Another client of the same agent principal (hosted
 *   MCP sessions of one connector share theirs) forgets nothing. An unstamped present agent's
 *   awareness id is not known either way (`undefined`): an undo of a step under it waits until
 *   the relay vouches for it.
 * - `destroy`: forgets everything and stops watching presence; the history calls it when it is
 *   destroyed. A tracker belongs to one history: give each its own.
 *
 * Presence is watched while an id awaits its stamp or is remembered: each awareness change as it
 * arrives where the source offers it (`subscribeChanges`), so a restamp and its holder
 * leaving within one flush are both seen; else each flush.
 *
 * @param presence - The user's client's presence.
 * @param operatorId - The user's id as tokens carry it: the bare id, without `user:`.
 * @param isConnected - Whether the client is connected and caught up now.
 * @returns The writers.
 */
export function trackOperatedWriters(
  presence: OperatedPresenceSource,
  operatorId: string,
  isConnected: () => boolean,
): OperatedWriters {
  const remembered = new Map<number, RememberedWriter>();
  // Ids recorded before their stamp arrived.
  const awaiting = new Set<number>();
  // Presence is watched while an id awaits its stamp or is remembered, so a stamp that drops a
  // remembered id is seen even when no one asks before its holder leaves.
  let unsubscribe: (() => void) | undefined;
  // One change as the relay sent it, which a flush may fold away. Only a change of
  // the user's agents, or of one awaiting its stamp, can remember an id.
  const observeChange = (changed: ReadonlyMap<number, PresenceState | undefined>): void => {
    const canRemember = forgetDropped(remembered, changed, operatorId);
    if (canRemember || [...changed.keys()].some((clientId) => awaiting.has(clientId))) observe();
    else watch();
  };
  const watch = (): void => {
    if (awaiting.size > 0 || remembered.size > 0) {
      unsubscribe ??=
        presence.subscribeChanges?.(observeChange) ??
        presence.subscribe(() => {
          observe();
        });
    } else {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };
  const observe = (): OperatedWriterIds => {
    const snapshot = presence.getRemote();
    const ids = writersOperatedBy(snapshot, operatorId);
    const listedAnywhere = rememberVouched(snapshot, ids.vouched, remembered);
    for (const [id, { agent, holder }] of remembered) {
      const state = snapshot.get(holder);
      const listed = state === undefined ? [] : writerClientIdsOf(state);
      // Present, and its stamp leaves the id out: the relay found it contested (an empty stamp
      // too: restamping after a contest may leave none, as a relay restart does).
      const isContested =
        state !== undefined && (state.principal.id !== agent || !listed.includes(id));
      const isOthers = !ids.vouched.has(id) && listedAnywhere.has(id);
      if (isContested || isOthers) remembered.delete(id);
    }
    for (const id of awaiting) {
      if (remembered.has(id) || !ids.unstamped.has(id)) awaiting.delete(id);
    }
    watch();
    return ids;
  };
  return {
    records: (clientId) => {
      if (!isConnected()) return false;
      const { vouched, unstamped } = observe();
      if (vouched.has(clientId)) return true;
      if (!unstamped.has(clientId)) return false;
      awaiting.add(clientId);
      watch();
      return true;
    },
    owns: (clientId) => {
      const { unstamped } = observe();
      // A present agent's awareness id the relay has not stamped yet: not known either way.
      if (unstamped.has(clientId)) return undefined;
      return remembered.has(clientId);
    },
    destroy: () => {
      awaiting.clear();
      remembered.clear();
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

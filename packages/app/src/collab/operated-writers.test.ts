import { describe, expect, it } from 'vitest';

import type {
  PresenceChangeListener,
  PresenceSnapshot,
  PresenceState,
  WriterStampedPresence,
} from '@canvas/collab';
import { parseTransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import type { BoardConnectionStatus } from './board-connection-status.js';
import { operatedWritersOf } from './operated-writers.js';

// The person's undo history records the remote changes of the agents they operate,
// told by the relay-stamped presence, while the board is connected; it undoes them only under
// ids the relay vouched for.

/**
 * An agent's presence.
 *
 * @param id - Its principal id.
 * @param operatorId - Its operator.
 * @param writerClientIds - The ids the relay vouches it wrote with.
 * @returns The state.
 */
function agent(id: string, operatorId: string, writerClientIds: readonly number[]): PresenceState {
  const state: PresenceState & WriterStampedPresence = {
    principal: { id, kind: 'agent', name: id, color: '#112233', operatorId },
    updatedAt: 1,
    writerClientIds,
  };
  return state;
}

/**
 * A connection for a principal, whose state and presence the test changes.
 *
 * @param principalId - The person.
 * @returns The connection's parts the writers read, and setters.
 */
function connectionOf(principalId: string) {
  let state: BoardConnectionStatus['state'] = 'connected';
  let presence: PresenceSnapshot = new Map();
  const listeners = new Set<() => void>();
  const changeListeners = new Set<PresenceChangeListener>();
  return {
    origin: parseTransactionOrigin({ kind: 'user', principalId: principalId as PrincipalId }),
    status: () => ({ state }) as BoardConnectionStatus,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remotePresence: () => presence,
    subscribePresenceChanges: (listener: PresenceChangeListener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    listenerCount: () => listeners.size + changeListeners.size,
    /**
     * One awareness change as it arrives, before the connection's refresh folds it in: the
     * presence read now shows it, but no refresh is told.
     *
     * @param changed - The changed clients' states, undefined for one that left.
     */
    change: (changed: ReadonlyMap<number, PresenceState | undefined>) => {
      const next = new Map(presence);
      for (const [clientId, changedState] of changed) {
        if (changedState === undefined) next.delete(clientId);
        else next.set(clientId, changedState);
      }
      presence = next;
      for (const listener of [...changeListeners]) listener(changed);
    },
    set: (next: { state?: typeof state; presence?: PresenceSnapshot }) => {
      state = next.state ?? state;
      if (next.presence !== undefined) {
        // Every client of either snapshot changed, as one awareness change each.
        const changed = new Map<number, PresenceState | undefined>();
        for (const clientId of [...presence.keys(), ...next.presence.keys()]) {
          changed.set(clientId, next.presence.get(clientId));
        }
        presence = next.presence;
        for (const listener of [...changeListeners]) listener(changed);
      }
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('operatedWritersOf', () => {
  it("records and owns the person's agents' vouched ids, and records unstamped ones only", () => {
    const connection = connectionOf('user:ada');
    connection.set({
      presence: new Map([
        [11, agent('scout', 'ada', [11])],
        [21, agent('echo', 'ada', [])],
        [31, agent('pilot', 'bob', [31])],
      ]),
    });
    const writers = operatedWritersOf(connection);
    expect([11, 21, 31].map((id) => writers?.records(id))).toEqual([true, true, false]);
    expect([11, 21, 31].map((id) => writers?.owns(id))).toEqual([true, undefined, false]);
  });

  it('records nothing while the board catches up after (re)connecting', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11])]]) });
    const writers = operatedWritersOf(connection);
    for (const state of ['connecting', 'reconnecting', 'offline'] as const) {
      connection.set({ state });
      expect(writers?.records(11), state).toBe(false);
    }
  });

  it('remembers a vouched id for undo after the agent leaves, records none, and forgets one its stamp drops', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11, 12])]]) });
    const writers = operatedWritersOf(connection);
    expect(writers?.owns(12)).toBe(true);
    connection.set({ presence: new Map() });
    expect(writers?.owns(12)).toBe(true);
    // Gone, it writes no more: a write under its id now is someone else's, never recorded.
    expect(writers?.records(12)).toBe(false);
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11])]]) });
    expect(writers?.owns(12)).toBe(false);
    expect(writers?.owns(11)).toBe(true);
  });

  it('remembers a stamp that arrives after the write, though the agent leaves before the undo', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[21, agent('echo', 'ada', [])]]) });
    const writers = operatedWritersOf(connection);
    // Its first write arrives before the relay stamps it: recorded, not known yet.
    expect(writers?.records(21)).toBe(true);
    expect(writers?.owns(21)).toBeUndefined();
    // The stamp arrives, and nothing asks; then its hosted session idles out.
    connection.set({ presence: new Map([[21, agent('echo', 'ada', [21])]]) });
    connection.set({ presence: new Map() });
    expect(writers?.owns(21)).toBe(true);
    // Still watched while remembered; released with the history.
    expect(connection.listenerCount()).toBe(1);
    writers?.destroy?.();
    expect(connection.listenerCount()).toBe(0);
  });

  it('forgets nothing when a resumed session of the same agent comes back as a new client', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('connect:app', 'ada', [11])]]) });
    const writers = operatedWritersOf(connection);
    expect(writers?.owns(11)).toBe(true);
    connection.set({ presence: new Map() });
    connection.set({ presence: new Map([[31, agent('connect:app', 'ada', [])]]) });
    expect(writers?.owns(11)).toBe(true);
    expect(writers?.owns(31)).toBeUndefined();
    connection.set({ presence: new Map([[31, agent('connect:app', 'ada', [31])]]) });
    expect([11, 31].map((id) => writers?.owns(id))).toEqual([true, true]);
  });

  it('waits on an id whose client is back unstamped, and forgets it once that client leaves', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11])]]) });
    const writers = operatedWritersOf(connection);
    expect(writers?.owns(11)).toBe(true);
    // Its stamp is empty (the relay restarted, or found the id contested) until it writes again.
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [])]]) });
    expect(writers?.owns(11)).toBeUndefined();
    connection.set({ presence: new Map() });
    expect(writers?.owns(11)).toBe(false);
  });

  it('forgets an id restamped away though its agent left before the refresh', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11])]]) });
    const writers = operatedWritersOf(connection);
    expect(writers?.owns(11)).toBe(true);
    // The relay restamps it without 11, then it leaves: one refresh shows only the departure.
    connection.change(new Map([[11, agent('scout', 'ada', [])]]));
    connection.change(new Map([[11, undefined]]));
    connection.set({ presence: new Map() });
    expect(writers?.owns(11)).toBe(false);
  });

  it('forgets an id vouched for someone else', () => {
    const connection = connectionOf('user:ada');
    connection.set({ presence: new Map([[11, agent('scout', 'ada', [11])]]) });
    const writers = operatedWritersOf(connection);
    expect(writers?.owns(11)).toBe(true);
    connection.set({ presence: new Map([[41, agent('pilot', 'bob', [11])]]) });
    expect(writers?.owns(11)).toBe(false);
  });

  it('is absent for a guest, a local board or no connection', () => {
    expect(operatedWritersOf(connectionOf('guest:ada'))).toBeUndefined();
    const { origin, status } = connectionOf('user:ada');
    expect(operatedWritersOf({ origin, status })).toBeUndefined();
    expect(operatedWritersOf(undefined)).toBeUndefined();
  });
});

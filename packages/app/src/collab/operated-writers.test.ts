import { describe, expect, it } from 'vitest';

import type { PresenceSnapshot, PresenceState, WriterStampedPresence } from '@canvas/collab';
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
  return {
    origin: parseTransactionOrigin({ kind: 'user', principalId: principalId as PrincipalId }),
    status: () => ({ state }) as BoardConnectionStatus,
    remotePresence: () => presence,
    set: (next: { state?: typeof state; presence?: PresenceSnapshot }) => {
      state = next.state ?? state;
      presence = next.presence ?? presence;
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

  it('is absent for a guest, a local board or no connection', () => {
    expect(operatedWritersOf(connectionOf('guest:ada'))).toBeUndefined();
    const { origin, status } = connectionOf('user:ada');
    expect(operatedWritersOf({ origin, status })).toBeUndefined();
    expect(operatedWritersOf(undefined)).toBeUndefined();
  });
});

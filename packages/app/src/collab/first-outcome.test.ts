import { describe, expect, it } from 'vitest';

import type { CollabStatus, ConnectionState } from '@canvas/collab';

import type { BoardSyncClient } from './board-connection.js';
import { waitForFirstOutcome } from './first-outcome.js';

/**
 * A client whose state moves when the test says; only what `waitForFirstOutcome` reads.
 *
 * @param state - The state it starts in.
 * @returns The client and a function that moves it.
 */
function fakeClient(state: ConnectionState): {
  readonly client: BoardSyncClient;
  readonly moveTo: (next: ConnectionState) => void;
} {
  let status: CollabStatus = {
    state,
    lastSyncedAt: undefined,
    pendingUpdateCount: 0,
    isAcknowledged: false,
    isReadOnly: false,
    rejectionReason: undefined,
  };
  const listeners = new Set<(status: CollabStatus) => void>();
  const client = {
    get status() {
      return status;
    },
    subscribe: (listener: (status: CollabStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BoardSyncClient;
  const moveTo = (next: ConnectionState): void => {
    status = { ...status, state: next };
    for (const listener of listeners) listener(status);
  };
  return { client, moveTo };
}

describe('waitForFirstOutcome', () => {
  it('reads a refused token and an outdated build alike as refused, not as a failure', async () => {
    for (const state of ['unauthorized', 'outdated'] as const) {
      const { client, moveTo } = fakeClient('connecting');
      const outcome = waitForFirstOutcome(client, 1_000);
      moveTo(state);
      expect(await outcome).toBe('refused');
    }
  });

  it('settles at once for a client already outdated', async () => {
    expect(await waitForFirstOutcome(fakeClient('outdated').client, 1_000)).toBe('refused');
  });

  it('reads a first sync as connected and a lost first attempt as failed', async () => {
    const synced = fakeClient('connecting');
    const connected = waitForFirstOutcome(synced.client, 1_000);
    synced.moveTo('connected');
    expect(await connected).toBe('connected');
    const lost = fakeClient('connecting');
    const failed = waitForFirstOutcome(lost.client, 1_000);
    lost.moveTo('reconnecting');
    expect(await failed).toBe('failed');
  });
});

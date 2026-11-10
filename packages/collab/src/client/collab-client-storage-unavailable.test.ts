// The relay closes the waiters of a board whose load failed (storage briefly down) with
// 1013 `storage-unavailable`. The client retries it like a lost connection: `reconnecting`, the
// ordinary backoff up to its cap, never `unauthorized`, and without spending the one immediate
// token refresh a refusal gets.
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import type { ConnectionState } from './connection-state.js';
import type { BoardTokenRequest } from './token-source.js';

const STORAGE_UNAVAILABLE = { code: 1013, reason: 'storage-unavailable' } as const;

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * A provider handing out a distinct editor token on every call.
 *
 * @returns The provider, a spy.
 */
function freshTokens(): ReturnType<typeof vi.fn<(request?: BoardTokenRequest) => Promise<string>>> {
  let issued = 0;
  return vi.fn(() => {
    issued += 1;
    return Promise.resolve(unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_000 + issued }));
  });
}

it('retries 1013 at growing delays up to the cap, then syncs the held edits', async () => {
  harness = new ClientHarness();
  const { relay } = harness;
  relay.loadFailure = STORAGE_UNAVAILABLE;
  const getToken = freshTokens();
  const store = new YjsDocumentStore();
  const client = await harness.open({ store, getToken, reconnect: { maxDelayMs: 1_000 } });
  const states: ConnectionState[] = [client.status.state];
  client.subscribe((status) => states.push(status.state));
  addStickies(store, 2, { batchSize: 1 });
  await harness.settle();
  expect(client.status.state).toBe('reconnecting');
  expect(getToken).toHaveBeenCalledTimes(1);

  // 250, 500, 1 000, then the 1 000 ms cap: each attempt waits its whole delay.
  for (const delayMs of [250, 500, 1_000, 1_000]) {
    const before = getToken.mock.calls.length;
    await harness.advanceAndSettle(delayMs - 1);
    expect(getToken).toHaveBeenCalledTimes(before);
    await harness.advanceAndSettle(1);
    expect(getToken).toHaveBeenCalledTimes(before + 1);
    expect(client.status.state).toBe('reconnecting');
    expect(client.status.pendingUpdateCount).toBe(2);
  }

  relay.loadFailure = undefined;
  await harness.advanceAndSettle(1_000);
  expect(client.status.state).toBe('connected');
  expect(client.status.pendingUpdateCount).toBe(0);
  expect(Y.encodeStateVector(relay.doc)).toEqual(store.encodeStateVector());
  expect(states.filter((state, index) => state !== states[index - 1])).toEqual([
    'connecting',
    'reconnecting',
    'connected',
  ]);
  expect(client.status.rejectionReason).toBeUndefined();
  expect(getToken.mock.calls.every(([request]) => request?.isAfterRefusal !== true)).toBe(true);
});

it('keeps the immediate token refresh for a real refusal after a 1013', async () => {
  harness = new ClientHarness();
  const { relay } = harness;
  relay.loadFailure = STORAGE_UNAVAILABLE;
  const getToken = freshTokens();
  const client = await harness.open({ getToken });
  const states: ConnectionState[] = [client.status.state];
  client.subscribe((status) => states.push(status.state));
  await harness.settle();
  expect(client.status.state).toBe('reconnecting');

  // The next attempt's token has expired meanwhile: the refusal is refreshed at once, within the
  // same backoff step, because the 1013 before it spent nothing.
  relay.loadFailure = undefined;
  const second = unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_002 });
  relay.refusedTokens.set(second, 'expired');
  await harness.advanceAndSettle(250);
  expect(client.status.state).toBe('connected');
  expect(relay.receivedTokens).toHaveLength(3);
  expect(relay.receivedTokens[1]).toBe(second);
  expect(states).not.toContain('unauthorized');
});

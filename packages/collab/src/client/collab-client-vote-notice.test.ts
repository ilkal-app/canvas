import * as encoding from 'lib0/encoding';
import { expect, it, vi } from 'vitest';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { RELAY_MESSAGE_TYPES } from './relay-protocol.js';

// The relay's `votes-changed` notice reaches the client's vote listeners only, as
// `threads-changed` reaches its thread listeners; neither carries anything but its type.

/**
 * A stateless notice frame for the board a connection opened.
 *
 * @param type - The notice's type.
 * @returns The frame builder `sendToAll` takes.
 */
function notice(type: string): (name: string) => Uint8Array {
  return (name) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, name);
    encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES.stateless);
    encoding.writeVarString(encoder, JSON.stringify({ type }));
    return encoding.toUint8Array(encoder);
  };
}

it('delivers vote notices to vote listeners only, and none after destroy', async () => {
  const harness = new ClientHarness();
  try {
    const client = await harness.connect();
    await harness.settle();
    const votes = vi.fn();
    const threads = vi.fn();
    const remove = client.onVotesChanged(votes);
    client.onThreadsChanged(threads);
    harness.relay.sendToAll(notice('votes-changed'));
    harness.relay.run();
    expect([votes.mock.calls.length, threads.mock.calls.length]).toEqual([1, 0]);
    harness.relay.sendToAll(notice('threads-changed'));
    harness.relay.run();
    expect([votes.mock.calls.length, threads.mock.calls.length]).toEqual([1, 1]);
    remove();
    harness.relay.sendToAll(notice('votes-changed'));
    harness.relay.run();
    expect(votes).toHaveBeenCalledOnce();
    client.destroy();
    const late = vi.fn();
    client.onVotesChanged(late);
    expect(late).not.toHaveBeenCalled();
  } finally {
    harness.destroy();
  }
});

it('reports a vote listener that throws, and keeps the others and the connection', async () => {
  const harness = new ClientHarness();
  try {
    const onError = vi.fn();
    const client = await harness.connect({ onError });
    await harness.settle();
    const failure = new Error('listener failed');
    client.onVotesChanged(() => {
      throw failure;
    });
    const healthy = vi.fn();
    client.onVotesChanged(healthy);
    harness.relay.sendToAll(notice('votes-changed'));
    harness.relay.run();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(healthy).toHaveBeenCalledOnce();
    expect(client.status.state).toBe('connected');
  } finally {
    harness.destroy();
  }
});

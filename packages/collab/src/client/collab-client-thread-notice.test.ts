import * as encoding from 'lib0/encoding';
import { expect, it, vi } from 'vitest';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { RELAY_MESSAGE_TYPES } from './relay-protocol.js';

it('delivers authenticated thread invalidations through the public client subscription and unregisters it', async () => {
  const harness = new ClientHarness();
  try {
    const client = await harness.connect();
    await harness.settle();
    const listener = vi.fn();
    const remove = client.onThreadsChanged(listener);
    const notice = (name: string) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, name);
      encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES.stateless);
      encoding.writeVarString(encoder, '{"type":"threads-changed"}');
      return encoding.toUint8Array(encoder);
    };
    harness.relay.sendToAll(notice);
    harness.relay.run();
    expect(listener).toHaveBeenCalledOnce();
    remove();
    harness.relay.sendToAll(notice);
    harness.relay.run();
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    harness.destroy();
  }
});

it('reports a failed listener without breaking other listeners or transport', async () => {
  const harness = new ClientHarness();
  try {
    const onError = vi.fn();
    const client = await harness.connect({ onError });
    await harness.settle();
    const failure = new Error('listener failed');
    client.onThreadsChanged(() => {
      throw failure;
    });
    const healthy = vi.fn();
    client.onThreadsChanged(healthy);
    harness.relay.sendToAll((name) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, name);
      encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES.stateless);
      encoding.writeVarString(encoder, '{"type":"threads-changed"}');
      return encoding.toUint8Array(encoder);
    });
    harness.relay.run();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(healthy).toHaveBeenCalledOnce();
    expect(client.status.state).toBe('connected');
  } finally {
    harness.destroy();
  }
});

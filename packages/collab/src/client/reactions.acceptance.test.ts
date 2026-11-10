// CONTRACT: reactions use only the current authenticated socket;
// listener failures are reported without ending collaboration or silencing peers.
import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReactionChannel } from '../presence/reaction-channel.js';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { RELAY_MESSAGE_TYPES } from './relay-protocol.js';

const DROP = { emoji: '🙌', x: 12, y: 13, pageId: 'page-1' } as const;
let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

function reactionFrame(name: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, name);
  encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES.stateless);
  encoding.writeVarString(encoder, JSON.stringify({ type: 'reaction', ...DROP, from: 'other' }));
  return encoding.toUint8Array(encoder);
}

describe('reaction collab acceptance', () => {
  it('returns false offline and during reconnect, then sends on the new connection only', async () => {
    harness = new ClientHarness();
    const reactions = new ReactionChannel();
    const client = await harness.connect({ reactions });
    await harness.settle();
    expect(reactions.send(DROP)).toBe(true);
    harness.relay.run();
    expect(
      harness.relay.received.filter((entry) => entry.kind === 'other').at(-1)?.connection,
    ).toBe(1);

    harness.relay.drop();
    expect(client.status.state).toBe('reconnecting');
    expect(reactions.send(DROP)).toBe(false);
    harness.network.set(false);
    expect(client.status.state).toBe('offline');
    expect(reactions.send(DROP)).toBe(false);
    harness.network.set(true);
    expect(reactions.send(DROP)).toBe(false);
    harness.relay.run();
    expect(client.status.state).toBe('connected');
    expect(reactions.send(DROP)).toBe(true);
    harness.relay.run();
    expect(
      harness.relay.received.filter((entry) => entry.kind === 'other').at(-1)?.connection,
    ).toBe(2);
    expect(harness.relay.reactions).toHaveLength(2);
  });

  it('reports a listener error and still delivers to another listener on the same connection', async () => {
    harness = new ClientHarness();
    const reactions = new ReactionChannel();
    const failure = new Error('reaction listener failed');
    const errors: unknown[] = [];
    const healthy = vi.fn();
    reactions.subscribe(() => {
      throw failure;
    });
    reactions.subscribe(healthy);
    const client = await harness.connect({ reactions, onError: (error) => errors.push(error) });
    await harness.settle();
    harness.relay.sendToAll(reactionFrame);
    harness.relay.run();
    expect(errors).toEqual([failure]);
    expect(healthy).toHaveBeenCalledOnce();
    expect(client.status.state).toBe('connected');
    harness.relay.sendToAll(reactionFrame);
    harness.relay.run();
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(client.status.state).toBe('connected');
  });
});

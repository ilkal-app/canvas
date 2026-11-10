import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { ClientHarness } from './__fixtures__/client-harness.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

function setUp(): ClientHarness {
  harness = new ClientHarness();
  return harness;
}

describe('CollabClient reconnection', () => {
  it('reconnects after the backoff when the relay drops, and resets the backoff once synced', async () => {
    const { relay } = setUp();
    const client = await harness.connect();
    relay.drop();
    expect(client.status.state).toBe('reconnecting');
    harness.advance(249);
    expect(client.status.state).toBe('reconnecting');
    harness.advance(1);
    expect(client.status.state).toBe('connected');
    relay.drop();
    harness.advance(250);
    expect(client.status.state).toBe('connected');
  });

  it('doubles the wait while the relay stays unreachable, up to the cap', async () => {
    const { relay, time } = setUp();
    const attemptsAtMs: number[] = [];
    const client = await harness.connect({
      reconnect: { maxDelayMs: 1_000 },
      socketFactory: (url, handlers) => {
        attemptsAtMs.push(time.now());
        return relay.socketFactory(url, handlers);
      },
    });
    relay.isReachable = false;
    relay.drop();
    for (let elapsedMs = 0; elapsedMs < 4_000; elapsedMs += 50) harness.advance(50);
    expect(client.status.state).toBe('reconnecting');
    expect(attemptsAtMs).toEqual([0, 250, 750, 1_750, 2_750, 3_750]);
    relay.isReachable = true;
    harness.advance(1_000);
    expect(client.status.state).toBe('connected');
  });

  it('spaces attempts by the jittered backoff', async () => {
    const { relay } = setUp();
    const client = await harness.connect({ random: () => 0.5 });
    relay.drop();
    harness.advance(187);
    expect(client.status.state).toBe('reconnecting');
    harness.advance(1);
    expect(client.status.state).toBe('connected');
  });

  it('drops a connection that stays silent for the idle timeout', async () => {
    const { relay } = setUp();
    const client = await harness.connect({ idleTimeoutMs: 5_000 });
    relay.isResponsive = false;
    harness.advance(4_999);
    expect(client.status.state).toBe('connected');
    harness.advance(1);
    expect(client.status.state).toBe('reconnecting');
    relay.isResponsive = true;
    harness.advance(250);
    expect(client.status.state).toBe('connected');
  });

  it('reconnects when the relay closes the board or sends a frame it cannot read', async () => {
    const { relay } = setUp();
    const errors: unknown[] = [];
    const client = await harness.connect({ onError: (error) => errors.push(error) });
    relay.sendToAll(() => new Uint8Array([7, 98, 111]));
    relay.run();
    expect(client.status.state).toBe('reconnecting');
    expect(errors).toHaveLength(1);
    harness.advance(250);
    expect(client.status.state).toBe('connected');
  });
});

describe('CollabClient offline edits', () => {
  it('keeps edits made while disconnected and sends them in one step 2 on reconnection', async () => {
    const { relay } = setUp();
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    relay.isReachable = false;
    relay.drop();
    addStickies(store, 3, { batchSize: 1 });
    expect(client.status.pendingUpdateCount).toBe(3);
    harness.advance(10_000);
    expect(relay.received.filter((frame) => frame.kind === 'update')).toHaveLength(0);
    relay.isReachable = true;
    harness.advance(10_000);
    expect(client.status.state).toBe('connected');
    expect(client.status.pendingUpdateCount).toBe(0);
    expect(Y.encodeStateVector(relay.doc)).toEqual(store.encodeStateVector());
  });

  it('holds edits made before the handshake and sends later ones live, in order', async () => {
    const { relay } = setUp();
    const store = new YjsDocumentStore();
    await harness.open({ store });
    addStickies(store, 2, { batchSize: 1, seed: 1 });
    relay.run();
    addStickies(store, 1, { seed: 2 });
    relay.run();
    const kinds = relay.received.filter((frame) => frame.kind !== 'awareness');
    expect(kinds.map((frame) => frame.kind)).toEqual([
      'auth',
      'sync-step-1',
      'sync-step-2',
      'update',
    ]);
  });

  it('resends only what the relay lacks: an offline edit, not the board', async () => {
    const { relay } = setUp();
    const store = new YjsDocumentStore();
    addStickies(store, 1_000, { seed: 3 });
    const fullStateBytes = store.encodeState().length;
    await harness.connect({ store });
    expect(relay.syncBytesOn(1)).toBeGreaterThan(fullStateBytes);

    relay.drop();
    const relayVector = Y.encodeStateVector(relay.doc);
    addStickies(store, 1, { seed: 4 });
    const missing = store.encodeState(relayVector).length;
    harness.advance(250);
    const resyncBytes = relay.syncBytesOn(2);
    const vectorBytes = store.encodeStateVector().length;
    // Framing: document name, message and sync types, and two length prefixes.
    expect(resyncBytes).toBeLessThanOrEqual(missing + vectorBytes + 2 * 16);
    expect(resyncBytes).toBeLessThan(fullStateBytes / 50);
  });

  it('receives the edits another client made while it was offline', async () => {
    const { relay } = setUp();
    const alice = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    await harness.connect({ store: alice });
    const bobClient = await harness.connect({ store: bob });
    bobClient.disconnect();
    relay.run();
    addStickies(alice, 2, { seed: 5 });
    addStickies(bob, 1, { seed: 6 });
    relay.run();
    bobClient.connect();
    relay.run();
    expect(alice.read().objects.size).toBe(3);
    expect(bob.read().objects.size).toBe(3);
  });
});

describe('CollabClient offline state', () => {
  it('goes offline with the network, stops retrying, and connects at once when it returns', async () => {
    const { relay, network } = setUp();
    const client = await harness.connect();
    network.set(false);
    relay.run();
    expect(client.status.state).toBe('offline');
    harness.advance(60_000);
    expect(relay.openConnectionCount).toBe(0);
    network.set(true);
    expect(client.status.state).toBe('connecting');
    relay.run();
    expect(client.status.state).toBe('connected');
  });

  it('starts offline when the device is, and connects once it is online', async () => {
    const { relay, network } = setUp();
    network.set(false);
    const client = await harness.connect();
    expect(client.status.state).toBe('offline');
    expect(relay.received).toHaveLength(0);
    network.set(true);
    relay.run();
    expect(client.status.state).toBe('connected');
  });

  it('stays offline after disconnect() until connect(), whatever the network does', async () => {
    const { relay, network } = setUp();
    const client = await harness.connect();
    client.disconnect();
    network.set(false);
    network.set(true);
    harness.advance(60_000);
    expect(client.status.state).toBe('offline');
    network.set(false);
    client.connect();
    expect(client.status.state).toBe('offline');
    network.set(true);
    relay.run();
    expect(client.status.state).toBe('connected');
  });

  it('ignores connect() while already connected', async () => {
    setUp();
    const client = await harness.connect();
    client.connect();
    expect(client.status.state).toBe('connected');
  });
});

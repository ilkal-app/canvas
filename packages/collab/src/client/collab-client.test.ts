import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';
import { MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import type { CollabStatus } from './collab-client-options.js';
import { createCollabClient } from './create-collab-client.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

function setUp(): ClientHarness {
  harness = new ClientHarness();
  return harness;
}

describe('createCollabClient', () => {
  it('connects, authenticates and syncs, then reports connected with the sync time', async () => {
    const { relay, time } = setUp();
    time.advanceBy(1_000);
    const client = await harness.open();
    expect(client.status.state).toBe('connecting');
    relay.run();
    expect(client.status).toEqual({
      state: 'connected',
      lastSyncedAt: 1_000,
      pendingUpdateCount: 0,
      isReadOnly: false,
      isAcknowledged: true,
      rejectionReason: undefined,
    });
    expect(client.lastSyncedAt).toBe(1_000);
    expect(relay.received.map((frame) => frame.kind)).toEqual([
      'auth',
      'sync-step-1',
      'awareness',
      'sync-step-2',
    ]);
  });

  it("receives the relay's board and sends local edits live, one message each", async () => {
    const { relay } = setUp();
    const seeded = new YjsDocumentStore();
    addStickies(seeded, 3, { seed: 7 });
    Y.applyUpdate(relay.doc, seeded.encodeState());
    const store = new YjsDocumentStore();
    await harness.connect({ store });
    expect(store.read().objects.size).toBe(3);

    addStickies(store, 2, { seed: 8, batchSize: 1 });
    relay.run();
    expect(relay.received.filter((frame) => frame.kind === 'update')).toHaveLength(2);
    const mirror = new YjsDocumentStore();
    mirror.applyUpdate(Y.encodeStateAsUpdate(relay.doc), {
      kind: 'system',
      principalId: 'system' as never,
    });
    expect(mirror.read().objects.size).toBe(5);
  });

  it('converges two clients through the relay without echoing updates back', async () => {
    const { relay } = setUp();
    const alice = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    await harness.connect({ store: alice });
    await harness.connect({ store: bob });
    addStickies(alice, 1, { seed: 1 });
    addStickies(bob, 1, { seed: 2 });
    relay.run();
    expect(alice.read().objects.size).toBe(2);
    expect(bob.read().objects.size).toBe(2);
    expect(relay.received.filter((frame) => frame.kind === 'update')).toHaveLength(2);
  });

  it('counts pending updates until the relay acknowledges them', async () => {
    const { relay } = setUp();
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    const seen: CollabStatus[] = [];
    client.subscribe((status) => seen.push(status));
    harness.time.advanceBy(500);
    addStickies(store, 1);
    expect(client.status.pendingUpdateCount).toBe(1);
    relay.run();
    expect(client.status.pendingUpdateCount).toBe(0);
    expect(client.lastSyncedAt).toBe(500);
    expect(seen.map((status) => status.pendingUpdateCount)).toEqual([1, 0]);
  });

  it('stops notifying a listener once it unsubscribes, and survives a throwing listener', async () => {
    setUp();
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => undefined);
    client.subscribe(() => {
      throw new Error('listener failed');
    });
    addStickies(store, 1);
    unsubscribe();
    harness.relay.run();
    expect(listener).toHaveBeenCalledOnce();
    expect(microtask).toHaveBeenCalled();
  });

  it('rejects a token for another board, and a token that is not one', async () => {
    setUp();
    await expect(
      harness.open({ token: unsignedToken({ ...EDITOR_CLAIMS, boardId: 'board-2' }) }),
    ).rejects.toThrow(RangeError);
    await expect(harness.open({ token: 'not-a-token' })).rejects.toThrow(RangeError);
    expect(BOARD).toBe('board-1');
  });
});

describe('CollabClient authorization', () => {
  it('becomes unauthorized when the relay refuses the token, and never retries', async () => {
    const { relay } = setUp();
    relay.deniedReason = 'expired';
    const client = await harness.connect();
    expect(client.status.state).toBe('unauthorized');
    expect(client.status.rejectionReason).toBe('expired');
    harness.advance(60_000);
    client.connect();
    relay.run();
    expect(client.status.state).toBe('unauthorized');
    expect(relay.received.filter((frame) => frame.kind === 'auth')).toHaveLength(1);
    expect(relay.openConnectionCount).toBe(0);
  });

  it('treats the Unauthorized and Forbidden close codes as a refused token', async () => {
    for (const [code, reason] of [
      [4401, 'Unauthorized'],
      [4403, ''],
    ] as const) {
      const { relay } = setUp();
      const client = await harness.connect();
      relay.drop(code, reason);
      harness.advance(60_000);
      expect(client.status.state).toBe('unauthorized');
      expect(client.status.rejectionReason).toBe(reason || String(code));
      expect(relay.received.filter((frame) => frame.kind === 'auth')).toHaveLength(1);
      harness.destroy();
    }
  });

  it("reports a read-only connection and keeps a viewer's edits pending", async () => {
    const { relay } = setUp();
    relay.isReadOnly = true;
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    expect(client.status.isReadOnly).toBe(true);
    addStickies(store, 1);
    relay.run();
    expect(client.status.pendingUpdateCount).toBe(1);
  });
});

describe('CollabClient teardown', () => {
  it('goes offline when destroyed, stops listening to the store and closes the connection', async () => {
    const { relay } = setUp();
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    const listener = vi.fn();
    client.subscribe(listener);
    client.destroy();
    client.destroy();
    relay.run();
    expect(client.status.state).toBe('offline');
    expect(listener).toHaveBeenCalledOnce();
    expect(relay.openConnectionCount).toBe(0);
    addStickies(store, 1);
    expect(client.status.pendingUpdateCount).toBe(0);
  });
});

describe('CollabClient defaults', () => {
  it('uses the platform WebSocket, timers and randomness when nothing is injected', async () => {
    const client = await createCollabClient({
      store: new YjsDocumentStore(),
      boardId: BOARD,
      // Nothing listens on port 1, so the connection is refused at once.
      url: 'ws://127.0.0.1:1',
      token: unsignedToken(EDITOR_CLAIMS),
      cache: new MemoryDocumentCache(),
    });
    harness = new ClientHarness();
    await vi.waitFor(() => {
      expect(client.status.state).toBe('reconnecting');
    });
    client.destroy();
  });

  it('reports a frame it cannot read from a microtask when there is no onError', async () => {
    const { relay } = setUp();
    const client = await harness.connect();
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => undefined);
    relay.sendToAll(() => new Uint8Array([7, 98, 111]));
    relay.run();
    expect(microtask).toHaveBeenCalledOnce();
    expect(client.status.state).toBe('reconnecting');
  });
});

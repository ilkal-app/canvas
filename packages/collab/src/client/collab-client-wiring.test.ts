import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from '../cache/document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { RELAY_MESSAGE_TYPES } from './relay-protocol.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

function setUp(): ClientHarness {
  harness = new ClientHarness();
  return harness;
}

function relayFrame(documentName: string, type: number, write?: (e: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, type);
  write?.(encoder);
  return encoding.toUint8Array(encoder);
}

describe('CollabClient presence', () => {
  it('uses a signed display name over the local presence name', async () => {
    setUp();
    const client = await harness.connect({
      token: unsignedToken({ ...EDITOR_CLAIMS, name: 'Ada Verified' }),
      presence: { name: 'Forged' },
    });
    expect(client.presence?.getLocal().principal.name).toBe('Ada Verified');
  });

  it("stamps presence with the token's sub and principal, not with anything the app says", async () => {
    setUp();
    const agentToken = unsignedToken({
      ...EDITOR_CLAIMS,
      sub: 'agent-7',
      principal: 'agent',
      operatorId: 'user-ada',
    });
    const client = await harness.connect({ token: agentToken, presence: { name: 'Helper' } });
    expect(client.presence?.getLocal().principal).toMatchObject({
      id: 'agent-7',
      kind: 'agent',
      name: 'Helper',
    });
    expect(client.claims.operatorId).toBe('user-ada');
  });

  it("shows each client the other's cursor through the relay, and clears it when one leaves", async () => {
    const { relay, time } = setUp();
    const alice = await harness.connect({ presence: { name: 'Alice', color: '#112233' } });
    const bob = await harness.connect({
      token: unsignedToken({ ...EDITOR_CLAIMS, sub: 'user-bob' }),
      presence: { name: 'Bob', rateHz: 30, timeoutMs: 20_000 },
    });
    alice.presence?.setLocal({ cursor: { x: 10, y: 20 } });
    harness.advance(100);
    const seenByBob = [...(bob.presence?.getRemote().values() ?? [])];
    expect(seenByBob).toHaveLength(1);
    expect(seenByBob[0]?.principal).toMatchObject({ id: 'user-ada', color: '#112233' });
    expect(seenByBob[0]?.cursor).toEqual({ x: 10, y: 20 });
    alice.destroy();
    relay.run();
    time.advanceBy(1);
    expect(bob.presence?.getRemote().size).toBe(0);
  });

  it('publishes presence under the store`s Yjs client id, which the relay stamps writes by', async () => {
    setUp();
    const store = new YjsDocumentStore({ clientId: 4_242 });
    const client = await harness.connect({ store, presence: { name: 'Ada' } });
    expect(store.clientId).toBe(4_242);
    expect(client.presence?.clientId).toBe(4_242);
    expect(client.awareness.clientID).toBe(4_242);
  });

  it('forgets remote presence while disconnected', async () => {
    const { relay } = setUp();
    const alice = await harness.connect({ presence: { name: 'Alice' } });
    const bob = await harness.connect({ presence: { name: 'Bob' } });
    alice.presence?.setLocal({ cursor: { x: 1, y: 1 } });
    harness.advance(100);
    expect(bob.awareness.getStates().size).toBe(2);
    bob.disconnect();
    relay.run();
    expect(bob.awareness.getStates().size).toBe(1);
  });
});

describe('CollabClient protocol', () => {
  it('answers a ping, a token request and an awareness query', async () => {
    const { relay } = setUp();
    await harness.connect();
    const before = relay.received.length;
    relay.sendToAll(() => new Uint8Array([RELAY_MESSAGE_TYPES.ping]));
    relay.sendToAll((name) =>
      relayFrame(name, RELAY_MESSAGE_TYPES.auth, (e) => {
        encoding.writeVarUint(e, 0);
      }),
    );
    relay.sendToAll((name) => relayFrame(name, RELAY_MESSAGE_TYPES.queryAwareness));
    relay.sendToAll(() => relayFrame('other-board', RELAY_MESSAGE_TYPES.queryAwareness));
    relay.run();
    expect(relay.received.slice(before).map((frame) => frame.kind)).toEqual(['auth', 'awareness']);
  });

  it('reconnects when the relay closes the board', async () => {
    const { relay } = setUp();
    const client = await harness.connect();
    relay.sendToAll((name) =>
      relayFrame(name, RELAY_MESSAGE_TYPES.close, (e) => {
        encoding.writeVarString(e, 'bye');
      }),
    );
    relay.run();
    expect(client.status.state).toBe('reconnecting');
  });
});

describe('CollabClient cache', () => {
  it('loads the cached board into the store before it connects', async () => {
    const { relay } = setUp();
    const storage = new MemoryCacheStorage();
    const previous = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({
      store: previous,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
    });
    addStickies(previous, 4);
    await binding.flush();

    const store = new YjsDocumentStore();
    const client = await harness.open({ store, cache: new MemoryDocumentCache(storage) });
    expect(store.read().objects.size).toBe(4);
    expect(client.status.state).toBe('connecting');
    relay.run();
    expect(client.status.state).toBe('connected');
  });

  it('writes relayed updates to the cache too', async () => {
    const { relay } = setUp();
    const storage = new MemoryCacheStorage();
    const alice = new YjsDocumentStore();
    await harness.connect({ store: alice });
    await harness.connect({
      store: new YjsDocumentStore(),
      cache: new MemoryDocumentCache(storage),
    });
    addStickies(alice, 2);
    relay.run();
    const reopened = new YjsDocumentStore();
    await DocumentCacheBinding.open({
      store: reopened,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
    });
    expect(reopened.read().objects.size).toBe(2);
  });

  it('connects without the cache when it cannot be read, and reports why', async () => {
    const { relay } = setUp();
    const cache = new MemoryDocumentCache();
    cache.close();
    const onError = vi.fn();
    const client = await harness.connect({ cache, onError, compactEvery: 10 });
    expect(onError).toHaveBeenCalledOnce();
    expect(client.status.state).toBe('connected');
    expect(relay.openConnectionCount).toBe(1);
  });

  it("exposes its cache binding's pending writes, and none without a cache", async () => {
    setUp();
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store, cache: new MemoryDocumentCache() });
    expect(client.cacheWrites?.isPending).toBe(false);
    addStickies(store, 1);
    expect(client.cacheWrites?.isPending).toBe(true);
    await client.cacheWrites?.settled();
    expect(client.cacheWrites?.isPending).toBe(false);
    expect((await harness.connect()).cacheWrites).toBeUndefined();
  });

  it('rethrows a cache failure asynchronously when there is no onError', async () => {
    setUp();
    const cache = new MemoryDocumentCache();
    cache.close();
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => undefined);
    await harness.connect({ cache });
    expect(microtask).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { MalformedUpdateError, YjsDocumentStore } from '@canvas/document';

import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { COUNT_OVERFLOW_UPDATE, deepNestingUpdate } from './__fixtures__/hostile-updates.js';
import { encodeUpdateMessage } from './relay-protocol.js';

let harness: ClientHarness | undefined;
afterEach(() => harness?.destroy());

/**
 * Makes a small real update just above the supported plain-container bound.
 *
 * @returns Update-v1 bytes, with 129 containers and no objects.
 */
function deepUpdate(): Uint8Array {
  const doc = new Y.Doc();
  let value: unknown = 'leaf';
  for (let depth = 0; depth < 129; depth += 1) value = { child: value };
  doc.getMap('auxiliary').set('value', value);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

describe('unsupported update nesting stops synchronization', () => {
  it.each(['snapshot', 'tail'] as const)(
    'retains cached %s bytes and never opens a socket',
    async (source) => {
      harness = new ClientHarness();
      const storage = new MemoryCacheStorage();
      const cache = new MemoryDocumentCache(storage);
      const deep = deepUpdate();
      const board = storage.board(BOARD);
      if (source === 'snapshot') board.snapshot = { version: 1, bytes: deep };
      else {
        board.updates.set(1, deep);
        board.updates.set(2, new Uint8Array([0, 0]));
      }
      const cachedBefore = await cache.load(BOARD);
      const store = new YjsDocumentStore();
      const before = store.encodeState();
      const onError = vi.fn();
      const client = await harness.open({ store, cache, onError });
      expect(client.status).toMatchObject({
        state: 'outdated',
        rejectionReason: 'update-depth-exceeded',
      });
      await harness.advanceAndSettle(120_000);
      expect(harness.relay.openedUrls).toEqual([]);
      expect(store.encodeState()).toEqual(before);
      expect(await cache.load(BOARD)).toEqual(cachedBefore);
      expect(onError).not.toHaveBeenCalled();
      store.destroy();
    },
  );

  it('refuses relay bytes before applying them and does not reconnect', async () => {
    harness = new ClientHarness();
    Y.applyUpdate(harness.relay.doc, deepUpdate());
    const store = new YjsDocumentStore();
    const before = store.encodeState();
    const onError = vi.fn();
    const client = await harness.connect({ store, onError });
    expect(client.status).toMatchObject({
      state: 'outdated',
      rejectionReason: 'update-depth-exceeded',
    });
    await harness.advanceAndSettle(120_000);
    expect(harness.relay.openedUrls).toHaveLength(1);
    expect(store.encodeState()).toEqual(before);
    expect(onError).not.toHaveBeenCalled();
    store.destroy();
  });

  it.each([5_000, 200_000])(
    'refuses %i levels from the cache tail and from the relay without a crash',
    async (levels) => {
      harness = new ClientHarness();
      const storage = new MemoryCacheStorage();
      const cache = new MemoryDocumentCache(storage);
      const tail = storage.board(BOARD).updates;
      tail.set(1, deepNestingUpdate(levels));
      tail.set(2, new Uint8Array([0, 0]));
      const cachedStore = new YjsDocumentStore();
      const cached = await harness.open({ store: cachedStore, cache });
      expect(cached.status).toMatchObject({ rejectionReason: 'update-depth-exceeded' });
      const store = new YjsDocumentStore();
      const before = store.encodeState();
      const client = await harness.connect({ store });
      harness.relay.sendToAll((name) => encodeUpdateMessage(name, deepNestingUpdate(levels)));
      await harness.advanceAndSettle(0);
      expect(client.status).toMatchObject({ rejectionReason: 'update-depth-exceeded' });
      expect(store.encodeState()).toEqual(before);
      store.destroy();
      cachedStore.destroy();
    },
  );
});

describe('a count of plain values no bytes back', () => {
  it('reports a cached tail it cannot read, at once, and connects without it', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    const tail = storage.board(BOARD).updates;
    tail.set(1, COUNT_OVERFLOW_UPDATE);
    tail.set(2, new Uint8Array([0, 0]));
    const onError = vi.fn();
    const store = new YjsDocumentStore();
    const client = await harness.open({ store, cache: new MemoryDocumentCache(storage), onError });
    expect(onError).toHaveBeenCalledWith(expect.any(MalformedUpdateError));
    expect(client.status.rejectionReason).toBeUndefined();
    await harness.advanceAndSettle(0);
    expect(harness.relay.openedUrls).toHaveLength(1);
    store.destroy();
  });

  it('refuses the bytes from the relay before applying them', async () => {
    harness = new ClientHarness();
    const store = new YjsDocumentStore();
    const before = store.encodeState();
    const onError = vi.fn();
    await harness.connect({ store, onError });
    harness.relay.sendToAll((name) => encodeUpdateMessage(name, COUNT_OVERFLOW_UPDATE));
    await harness.advanceAndSettle(0);
    expect(onError).toHaveBeenCalledWith(expect.any(MalformedUpdateError));
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });
});

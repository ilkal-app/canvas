// A sync step 2 larger than one chunk replays the unsent transactions whole and in
// order: this session's from memory, else (after a reload) the cache's log, which the cache does
// not compact while the relay lacks any of it. Only a cache an older build compacted with unsent
// work in it is split by struct ranges, and that warns once. Every cut falls between two
// transactions, so an editor peer applying the chunks one by one never repairs anything.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, type YjsDocumentStore } from '@canvas/document';

import type { DocumentCache } from '../cache/document-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';
import { OUTBOUND_CHUNK_BYTES } from '../chunking/split-update.js';

import {
  cutsInsideTransactions,
  FRAMING_BYTES,
  peerRepairWrites,
  RELOADED_WRITER_ID,
  sizesOf,
  SlowLogCache,
  writeObjects,
  writerStore,
} from './__fixtures__/chunking-fixtures.js';
import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import type { CollabClient } from './collab-client.js';
import { encodeSyncStep1 } from './relay-protocol.js';
import { UnsentChangesSplitWarning } from './unsent-changes-split-warning.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/** A client of a new page load, and its store. */
interface Reloaded {
  readonly client: CollabClient;
  readonly store: YjsDocumentStore;
}

/**
 * A client of a new page load: a new store and a new connection to the cache's storage.
 *
 * @param cache - The new load's cache.
 * @param errors - Where the client's `onError` reports go.
 * @returns The client, not yet delivered anything, and its store.
 */
async function reload(cache: DocumentCache, errors: unknown[] = []): Promise<Reloaded> {
  const store = writerStore(RELOADED_WRITER_ID);
  const client = await harness.open({ store, cache, onError: (error) => errors.push(error) });
  return { client, store };
}

/**
 * Writes 600 transactions offline (about 1.2 MiB) on a client bound to a cache, lets a due
 * compaction have its idle time, and closes the page.
 *
 * @param storage - The cache's storage.
 * @returns Each transaction's end clock.
 */
async function offlineSessionThenClose(storage: MemoryCacheStorage): Promise<number[]> {
  const store = writerStore();
  const client = await harness.connect({ store, cache: new MemoryDocumentCache(storage) });
  client.disconnect();
  const ends = writeObjects(store, 1_800, 3);
  await harness.advanceAndSettle(20_000);
  client.destroy();
  return ends;
}

describe('CollabClient replays unsent transactions whole', { timeout: 30_000 }, () => {
  it("replays this session's unacknowledged updates from memory, with no cache", async () => {
    harness = new ClientHarness();
    const store = writerStore();
    const errors: unknown[] = [];
    const client = await harness.connect({ store, onError: (error) => errors.push(error) });
    client.disconnect();
    const ends = writeObjects(store, 2_400, 100);
    const whole = store.encodeSyncState(Y.encodeStateVector(harness.relay.doc));
    expect(whole.byteLength).toBeGreaterThan(OUTBOUND_CHUNK_BYTES);
    expect(client.status.pendingUpdateCount).toBe(24);
    client.connect();
    harness.relay.run();
    const steps = sizesOf(harness.relay, 'sync-step-2', 2);
    expect(steps.length).toBeGreaterThan(1);
    for (const size of steps)
      expect(size).toBeLessThanOrEqual(OUTBOUND_CHUNK_BYTES + FRAMING_BYTES);
    expect(cutsInsideTransactions(harness.relay, steps.length, ends)).toEqual([]);
    expect(peerRepairWrites(harness.relay)).toBe(0);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(client.status).toMatchObject({ state: 'connected', pendingUpdateCount: 0 });
    expect(errors).toEqual([]);
  });

  it('keeps 600 offline transactions uncompacted, then after a reload replays them whole', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    const ends = await offlineSessionThenClose(storage);
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    expect(storage.board(BOARD).updates.size).toBeGreaterThanOrEqual(600);
    const errors: unknown[] = [];
    const { store } = await reload(new MemoryDocumentCache(storage), errors);
    await harness.settle();
    const steps = sizesOf(harness.relay, 'sync-step-2', 2);
    expect(steps.length).toBeGreaterThan(1);
    expect(cutsInsideTransactions(harness.relay, steps.length, ends)).toEqual([]);
    expect(peerRepairWrites(harness.relay)).toBe(0);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(errors).toEqual([]);
    // Acknowledged now: the compaction that waited runs at the next idle time.
    await harness.advanceAndSettle(20_000);
    expect(storage.board(BOARD).snapshot).toBeDefined();
    expect(storage.board(BOARD).updates.size).toBeLessThan(600);
  });

  it('holds edits made while the log is read, and answers a second state vector once', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    await offlineSessionThenClose(storage);
    const cache = new SlowLogCache(storage);
    const { client, store } = await reload(cache);
    await harness.settle();
    expect(sizesOf(harness.relay, 'sync-step-2', 2)).toEqual([]);
    const last = [...store.read().objects.keys()].at(-1);
    if (last === undefined) throw new Error('the session wrote objects');
    store.transact(SYSTEM_ORIGIN, (transaction) => transaction.deleteObject(last));
    expect(sizesOf(harness.relay, 'update', 2)).toEqual([]);
    expect(client.status.pendingUpdateCount).toBe(1);
    harness.relay.sendToAll((name) =>
      encodeSyncStep1(name, Y.encodeStateVector(harness.relay.doc)),
    );
    harness.relay.run();
    expect(sizesOf(harness.relay, 'sync-step-2', 2)).toEqual([]);
    cache.release();
    await harness.settle();
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(harness.relay.doc.getMap('objects').has(last)).toBe(false);
    expect(client.status).toMatchObject({ state: 'connected', pendingUpdateCount: 0 });
  });

  it('sends nothing from a replay whose connection dropped while the log was read', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    await offlineSessionThenClose(storage);
    const cache = new SlowLogCache(storage);
    const { client, store } = await reload(cache);
    await harness.settle();
    client.disconnect();
    cache.release();
    await harness.settle();
    expect(sizesOf(harness.relay, 'sync-step-2', 2)).toEqual([]);
    expect(client.status).toMatchObject({ state: 'offline', pendingUpdateCount: 0 });
    client.connect();
    await harness.settle();
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(client.status).toMatchObject({ state: 'connected', pendingUpdateCount: 0 });
  });

  it('splits by struct ranges, reporting the failure and warning, when the log cannot be read', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    await offlineSessionThenClose(storage);
    const failure = new Error('log unreadable');
    const cache = new SlowLogCache(storage, failure);
    cache.release();
    const errors: unknown[] = [];
    const { store } = await reload(cache, errors);
    await harness.settle();
    expect(errors).toEqual([failure, expect.any(UnsentChangesSplitWarning)]);
    expect(sizesOf(harness.relay, 'sync-step-2', 2).length).toBeGreaterThan(1);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
  });

  it('splits by struct ranges with a cache that cannot read its log, and warns', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    await offlineSessionThenClose(storage);
    const memory = new MemoryDocumentCache(storage);
    const cache: DocumentCache = {
      load: (boardId) => memory.load(boardId),
      append: (boardId, update) => memory.append(boardId, update),
      compact: (boardId, snapshot) => memory.compact(boardId, snapshot),
      delete: (boardId) => memory.delete(boardId),
      close: () => {
        memory.close();
      },
    };
    const errors: unknown[] = [];
    const { store } = await reload(cache, errors);
    await harness.settle();
    expect(errors).toEqual([expect.any(UnsentChangesSplitWarning)]);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
  });

  it('splits a legacy cache compacted with unsent work by struct ranges, warning once', async () => {
    // A build before compacted the log while the relay lacked it: the unsent work is
    // only in the snapshot, so no replay can cover it.
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    const offline = writerStore();
    writeObjects(offline, 2_400, 100);
    storage.board(BOARD).snapshot = { version: 1, bytes: offline.encodeState() };
    const errors: unknown[] = [];
    const { store } = await reload(new MemoryDocumentCache(storage), errors);
    await harness.settle();
    expect(errors).toEqual([expect.any(UnsentChangesSplitWarning)]);
    const steps = sizesOf(harness.relay, 'sync-step-2', 1);
    expect(steps.length).toBeGreaterThan(1);
    for (const size of steps)
      expect(size).toBeLessThanOrEqual(OUTBOUND_CHUNK_BYTES + FRAMING_BYTES);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    harness.relay.drop();
    await harness.advanceAndSettle(1_000);
    expect(errors).toHaveLength(1);
  });
});

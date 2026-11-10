// Fix round 2: a read-only connection (a viewer, a commenter) never has its updates
// applied (the relay answers "not applied"), so it must not hold the cache's compactions: one
// refused local write would otherwise stop them for good while the log grows with the board's
// traffic. The writes stay counted as pending; their bytes are not kept for a replay.
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';

import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { writeObjects, writerStore } from './__fixtures__/chunking-fixtures.js';
import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { encodeUpdateMessage } from './relay-protocol.js';
import { UnsentChangesSplitWarning } from './unsent-changes-split-warning.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * Relays `count` updates of another writer to every connection, as a busy board would.
 *
 * @param count - How many updates.
 */
function relayPeerUpdates(count: number): void {
  const peer = new Y.Doc();
  for (let index = 0; index < count; index += 1) {
    const before = Y.encodeStateVector(peer);
    peer.getMap('meta').set(`peer-${String(index)}`, index);
    const update = Y.encodeStateAsUpdate(peer, before);
    harness.relay.sendToAll((name) => encodeUpdateMessage(name, update));
  }
  harness.relay.run();
}

it('lets a viewer with a refused local write compact its cache', async () => {
  harness = new ClientHarness();
  harness.relay.isReadOnly = true;
  const storage = new MemoryCacheStorage();
  const store = writerStore();
  const client = await harness.connect({
    store,
    cache: new MemoryDocumentCache(storage),
    compactEvery: 5,
  });
  expect(client.status.isReadOnly).toBe(true);
  writeObjects(store, 3, 3);
  harness.relay.run();
  expect(client.status.pendingUpdateCount).toBe(1);
  relayPeerUpdates(10);
  await harness.advanceAndSettle(20_000);
  expect(client.status.pendingUpdateCount).toBe(1);
  expect(storage.board(BOARD).snapshot).toBeDefined();
  expect(storage.board(BOARD).updates.size).toBeLessThan(5);
});

it('releases the hold when an editor with unsent work comes back as a viewer', async () => {
  harness = new ClientHarness();
  const storage = new MemoryCacheStorage();
  const store = writerStore();
  const client = await harness.connect({
    store,
    cache: new MemoryDocumentCache(storage),
    compactEvery: 5,
  });
  client.disconnect();
  writeObjects(store, 30, 3);
  await harness.advanceAndSettle(20_000);
  expect(storage.board(BOARD).snapshot).toBeUndefined();
  harness.relay.isReadOnly = true;
  client.connect();
  await harness.settle();
  expect(client.status).toMatchObject({ isReadOnly: true, pendingUpdateCount: 10 });
  // The compaction that was due runs at the next idle time.
  await harness.advanceAndSettle(20_000);
  expect(storage.board(BOARD).snapshot).toBeDefined();
});

it.each([false, true])(
  'replays offline transactions from memory only when their bytes were kept (read-only=%s)',
  async (isReadOnly) => {
    harness = new ClientHarness();
    harness.relay.isReadOnly = isReadOnly;
    const store = writerStore();
    const errors: unknown[] = [];
    const client = await harness.connect({ store, onError: (error) => errors.push(error) });
    client.disconnect();
    writeObjects(store, 2_000, 100);
    expect(client.status.pendingUpdateCount).toBe(20);
    harness.relay.isReadOnly = false;
    client.connect();
    harness.relay.run();
    expect(errors).toEqual(isReadOnly ? [expect.any(UnsentChangesSplitWarning)] : []);
    expect(client.status).toMatchObject({ state: 'connected', pendingUpdateCount: 0 });
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
  },
);

it('resumes keeping transaction bytes after a viewer becomes an editor', async () => {
  harness = new ClientHarness();
  harness.relay.isReadOnly = true;
  const store = writerStore();
  const errors: unknown[] = [];
  const client = await harness.connect({ store, onError: (error) => errors.push(error) });
  client.disconnect();
  harness.relay.isReadOnly = false;
  client.connect();
  harness.relay.run();
  client.disconnect();
  writeObjects(store, 2_000, 100);
  client.connect();
  harness.relay.run();
  expect(errors).toEqual([]);
  expect(client.status).toMatchObject({ state: 'connected', pendingUpdateCount: 0 });
  expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
});

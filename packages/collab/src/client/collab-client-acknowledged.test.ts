// Item 4 fix round 1: `CollabStatus.isAcknowledged` says when the relay has everything
// this connection holds. Edits restored from the cache after a reload never count as pending,
// and `connected` arrives with the relay's own step 2, before the relay has acknowledged the
// client's step 2 that carries them; so "connected with nothing pending" does not mean "sent",
// and the site needs this field before it forgets that a board holds unsent edits.
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { RELOADED_WRITER_ID, writeObjects, writerStore } from './__fixtures__/chunking-fixtures.js';
import { ClientHarness } from './__fixtures__/client-harness.js';
import type { CollabStatus } from './collab-client-options.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * Leaves edits made offline in a cache's storage, as a page closed before reconnecting does.
 *
 * @param storage - The cache's storage.
 */
async function leaveOfflineEdits(storage: MemoryCacheStorage): Promise<void> {
  const store = writerStore();
  const client = await harness.connect({ store, cache: new MemoryDocumentCache(storage) });
  client.disconnect();
  writeObjects(store, 6, 3);
  await harness.settle();
  client.destroy();
}

describe('CollabStatus.isAcknowledged', () => {
  it('is true once connected with everything acknowledged, false while an edit is in flight', async () => {
    harness = new ClientHarness();
    const store = writerStore();
    const client = await harness.connect({ store });
    await harness.settle();
    expect(client.status).toMatchObject({ state: 'connected', isAcknowledged: true });
    writeObjects(store, 1, 1);
    expect(client.status).toMatchObject({ pendingUpdateCount: 1, isAcknowledged: false });
    harness.relay.run();
    expect(client.status).toMatchObject({ pendingUpdateCount: 0, isAcknowledged: true });
  });

  it('stays false after a reload until the relay acknowledges the restored edits', async () => {
    harness = new ClientHarness();
    const storage = new MemoryCacheStorage();
    await leaveOfflineEdits(storage);
    // The reloaded page: the relay answers with its step 2 (the client is connected) but never
    // takes the client's own step 2, which carries the restored edits; then the socket drops.
    const statuses: CollabStatus[] = [];
    const store = writerStore(RELOADED_WRITER_ID);
    const client = await harness.open({ store, cache: new MemoryDocumentCache(storage) });
    const stopWatching = client.subscribe((status) => {
      statuses.push(status);
      if (status.state === 'connected') harness.relay.isResponsive = false;
    });
    await harness.settle();
    const connected = statuses.filter(({ state }) => state === 'connected');
    expect(connected.length).toBeGreaterThan(0);
    expect(connected.every((status) => status.pendingUpdateCount === 0)).toBe(true);
    expect(connected.some((status) => status.isAcknowledged)).toBe(false);

    harness.relay.drop();
    expect(client.status).toMatchObject({ state: 'reconnecting', isAcknowledged: false });

    stopWatching();
    harness.relay.isResponsive = true;
    await harness.advanceAndSettle(20_000);
    expect(client.status).toMatchObject({ state: 'connected', isAcknowledged: true });
  });
});

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME, YjsDocumentStore } from '@canvas/document';

import {
  cacheAtLayout,
  earlierLayoutBoard,
  holdsObject,
} from '../cache/__fixtures__/earlier-layout-board.js';
import { openIndexedDbCache } from '../cache/indexeddb-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * A harness whose relay holds the fixture's board, and a device whose layout-1 cache holds that
 * board and the offline edit the relay lacks.
 *
 * @returns The harness and the IndexedDB factory of the device.
 */
async function setUp(): Promise<{ readonly factory: IDBFactory }> {
  harness = new ClientHarness();
  const { relay, offline } = earlierLayoutBoard();
  Y.applyUpdate(harness.relay.doc, relay.encodeState());
  const factory = new IDBFactory();
  await cacheAtLayout(factory, 1, BOARD, relay, [offline]);
  return { factory };
}

/**
 * Whether the relay's board holds an object.
 *
 * @param id - The object's id.
 * @returns Whether it does.
 */
function relayHolds(id: string): boolean {
  return harness.relay.doc.getMap(OBJECTS_MAP_NAME).has(id);
}

describe('CollabClient layout carry-over', () => {
  it("sends a layout-1 copy's unsent edits after the first sync, then deletes the copy", async () => {
    const { factory } = await setUp();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const client = await harness.connect({ cache });
    await client.layoutCarryOver?.run(true);
    harness.relay.run();
    expect(relayHolds('offline')).toBe(true);
    expect(client.layoutCarryOver?.stranded).toEqual([]);
    expect(await cache.earlierLayouts.find(BOARD)).toEqual([]);
  });

  it('reports, and keeps, what a read-only connection cannot send', async () => {
    const { factory } = await setUp();
    harness.relay.isReadOnly = true;
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const store = new YjsDocumentStore();
    const client = await harness.connect({ cache, store });
    await client.layoutCarryOver?.run(true);
    expect(client.layoutCarryOver?.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache:layout:1:recovery:1',
        fromLayoutVersion: 1,
        toLayoutVersion: 2,
        unsentChangeCount: 1,
      },
    ]);
    expect(holdsObject(store, 'offline')).toBe(false);
    expect(await cache.earlierLayouts.find(BOARD)).toHaveLength(1);
  });

  it('reports what no converter carries, with the converters the options give', async () => {
    const { factory } = await setUp();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const onError = vi.fn();
    const client = await harness.connect({ cache, layoutConverters: new Map(), onError });
    await client.layoutCarryOver?.run(true);
    harness.relay.run();
    expect(relayHolds('offline')).toBe(false);
    expect(client.layoutCarryOver?.stranded).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('checks nothing before the first sync, nor on a reconnection', async () => {
    const { factory } = await setUp();
    harness.network.set(false);
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const find = vi.spyOn(cache.earlierLayouts, 'find');
    const client = await harness.open({ cache });
    harness.relay.run();
    expect(find).not.toHaveBeenCalled();
    harness.network.set(true);
    harness.relay.run();
    expect(find).toHaveBeenCalledTimes(1);
    await client.layoutCarryOver?.run(true);
    harness.relay.drop();
    await harness.advanceAndSettle(60_000);
    expect(client.status.state).toBe('connected');
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('has no carry-over for a cache without earlier layouts', async () => {
    harness = new ClientHarness();
    const cache = new MemoryDocumentCache(new MemoryCacheStorage());
    const client = await harness.connect({ cache });
    expect(client.layoutCarryOver).toBeUndefined();
    const uncached = await harness.connect();
    expect(uncached.layoutCarryOver).toBeUndefined();
  });
});

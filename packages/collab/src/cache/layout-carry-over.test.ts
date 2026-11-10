import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { BOARD, carryOverOf, openSynced } from './__fixtures__/carry-over-harness.js';
import {
  cacheAtLayout,
  earlierLayoutBoard as fixture,
  holdsObject as holds,
} from './__fixtures__/earlier-layout-board.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { layoutStepKey } from './layout-converters.js';

describe('LayoutCarryOver', () => {
  it('deletes an earlier copy holding nothing the relay lacks, and says nothing', async () => {
    const factory = new IDBFactory();
    const { relay } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, []);
    const opened = await openSynced(factory, 3, relay);
    const carryOver = carryOverOf(opened);
    const listener = vi.fn();
    carryOver.subscribe(listener);
    await carryOver.run(true);
    expect(carryOver.stranded).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
  });

  it('carries unsent edits through the converter, stores them, then deletes the copy', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const convert = vi.fn((unsent: Uint8Array) => unsent);
    const carryOver = carryOverOf(opened, {
      converters: new Map([[layoutStepKey(2, 3), convert]]),
    });
    await carryOver.run(true);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(holds(opened.store, 'offline')).toBe(true);
    expect(carryOver.stranded).toEqual([]);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
    const reopened = new YjsDocumentStore({ clientId: 4 });
    const restored = await opened.cache.load(BOARD);
    for (const update of restored.updates) reopened.applyUpdate(update, SYSTEM_ORIGIN);
    expect(holds(reopened, 'offline')).toBe(true);
  });

  it('carries layout-1 edits to layout 2 by the default identity converter', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 1, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 2, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(holds(opened.store, 'offline')).toBe(true);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
  });

  it('carries layout-2 edits to layout 3 by the default identity converter', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(holds(opened.store, 'offline')).toBe(true);
    expect(carryOver.stranded).toEqual([]);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
  });

  it('carries layout-3 edits to layout 4 by the default identity converter', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 3, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 4, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(holds(opened.store, 'offline')).toBe(true);
    expect(carryOver.stranded).toEqual([]);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
  });

  it('reports unsent edits without a converter and keeps the copy until dismissed', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline, offline]);
    const opened = await openSynced(factory, 3, relay);
    // No registered converter: an empty registry stands for a bump that ships none.
    const carryOver = carryOverOf(opened, { converters: new Map() });
    const listener = vi.fn();
    carryOver.subscribe(listener);
    await carryOver.run(true);
    expect(holds(opened.store, 'offline')).toBe(false);
    expect(carryOver.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache:layout:2:recovery:1',
        fromLayoutVersion: 2,
        toLayoutVersion: 3,
        unsentChangeCount: 2,
      },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toHaveLength(1);
    await carryOver.dismiss('canvas-board-cache:layout:2:recovery:1');
    expect(carryOver.stranded).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
  });

  it('keeps and reports edits a read-only connection cannot send, converter or not', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 1, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 2, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(false);
    expect(holds(opened.store, 'offline')).toBe(false);
    expect(carryOver.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache:layout:1:recovery:1',
        fromLayoutVersion: 1,
        toLayoutVersion: 2,
        unsentChangeCount: 1,
      },
    ]);
  });

  it('keeps and reports a copy it cannot read, counting every record', async () => {
    const factory = new IDBFactory();
    const { relay } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [new Uint8Array([255, 255])]);
    const opened = await openSynced(factory, 3, relay);
    const onError = vi.fn();
    const carryOver = carryOverOf(opened, { onError });
    await carryOver.run(true);
    expect(onError).not.toHaveBeenCalled();
    expect(carryOver.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache:layout:2:recovery:1',
        fromLayoutVersion: 2,
        toLayoutVersion: 3,
        unsentChangeCount: 2,
      },
    ]);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toHaveLength(1);
  });

  it('counts an unreadable compacted snapshot as one of the records it keeps', async () => {
    const factory = new IDBFactory();
    const earlier = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    await earlier.load(BOARD);
    await earlier.compact(BOARD, new Uint8Array([255, 255]));
    earlier.close();
    const opened = await openSynced(factory, 3, fixture().relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(carryOver.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache:layout:2:recovery:1',
        fromLayoutVersion: 2,
        toLayoutVersion: 3,
        unsentChangeCount: 1,
      },
    ]);
  });

  it('keeps and reports edits the store refuses after conversion', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const onError = vi.fn();
    const broken = new Map([[layoutStepKey(2, 3), () => new Uint8Array([255, 255])]]);
    const carryOver = carryOverOf(opened, { converters: broken, onError });
    await carryOver.run(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(carryOver.stranded).toHaveLength(1);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toHaveLength(1);
  });

  it('runs one pass per open, however often it is asked', async () => {
    const factory = new IDBFactory();
    const { relay } = fixture();
    const opened = await openSynced(factory, 3, relay);
    const carryOver = carryOverOf(opened);
    const find = vi.spyOn(opened.cache.earlierLayouts ?? { find: () => undefined }, 'find');
    await Promise.all([carryOver.run(true), carryOver.run(true)]);
    await carryOver.run(false);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('reports a failed read and a failed dismissal, keeping what it reported', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const onError = vi.fn();
    const carryOver = carryOverOf(opened, { onError, converters: new Map() });
    await carryOver.run(true);
    const { earlierLayouts } = opened.cache;
    if (earlierLayouts === undefined) throw new Error('the IndexedDB cache has earlier layouts');
    vi.spyOn(earlierLayouts, 'delete').mockRejectedValueOnce(new Error('blocked'));
    await carryOver.dismiss('canvas-board-cache:layout:2:recovery:1');
    expect(onError).toHaveBeenCalledWith(new Error('blocked'));
    expect(carryOver.stranded).toHaveLength(1);
    const failing = carryOverOf(opened, { onError });
    vi.spyOn(earlierLayouts, 'find').mockRejectedValueOnce(new Error('refused'));
    await failing.run(true);
    expect(onError).toHaveBeenCalledWith(new Error('refused'));
  });

  it('changes nothing and tells no one once destroyed', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 1, BOARD, relay, [offline]);
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const onError = vi.fn();
    const carryOver = carryOverOf(opened, { onError });
    const listener = vi.fn();
    carryOver.subscribe(listener);
    const pass = carryOver.run(true);
    carryOver.destroy();
    await pass;
    expect(listener).not.toHaveBeenCalled();
    expect(carryOver.stranded).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('keeps the copy, and reports it, when the current cache cannot store the carried edits', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 1, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 2, relay);
    const onError = vi.fn();
    const quota = new DOMException('full', 'QuotaExceededError');
    const carryOver = carryOverOf(opened, {
      onError,
      storeDurably: () => Promise.reject(quota),
    });
    await carryOver.run(true);
    expect(onError).toHaveBeenCalledWith(quota);
    expect(carryOver.stranded).toHaveLength(1);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toHaveLength(1);
  });

  it('stores carried content the store holds pending before it deletes the copy', async () => {
    const factory = new IDBFactory();
    const { relay } = fixture();
    const device = new Y.Doc();
    device.clientID = 9;
    Y.applyUpdate(device, relay.encodeState());
    device.getMap('pending').set('first', 'lost with its message');
    const afterFirst = Y.encodeStateVector(device);
    device.getMap('pending').set('second', 'cached, waiting for the first');
    const dependent = Y.encodeStateAsUpdate(device, afterFirst);
    device.destroy();
    await cacheAtLayout(factory, 1, BOARD, relay, [dependent]);
    const opened = await openSynced(factory, 2, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(opened.store.hasPendingStructs).toBe(true);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
    const { updates } = await opened.cache.load(BOARD);
    const restored = new Y.Doc();
    for (const update of updates) Y.applyUpdate(restored, update);
    expect(restored.store.pendingStructs).not.toBeNull();
    restored.destroy();
  });

  it('dismisses only the records it read: an edit an old tab stores later stays', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    await cacheAtLayout(factory, 2, BOARD, relay, [offline]);
    const opened = await openSynced(factory, 3, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    const oldTab = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    await oldTab.append(BOARD, new Uint8Array([1, 2, 3]));
    oldTab.close();
    await carryOver.dismiss('canvas-board-cache:layout:2:recovery:1');
    expect(carryOver.stranded).toEqual([]);
    const left = await opened.cache.earlierLayouts?.find(BOARD);
    expect(left?.map(({ board }) => board)).toEqual([
      { snapshot: undefined, updates: [new Uint8Array([1, 2, 3])] },
    ]);
    await carryOver.dismiss('unknown');
  });
});

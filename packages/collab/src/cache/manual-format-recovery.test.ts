import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { earlierLayoutBoard, holdsObject } from './__fixtures__/earlier-layout-board.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { transact } from './indexeddb-earlier-layouts.js';
import { LayoutCarryOver } from './layout-carry-over.js';
import { layoutStepKey } from './layout-converters.js';
import { MemoryDocumentCache } from './memory-document-cache.js';

async function oldWriter(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open('canvas-board-cache:layout:2', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('snapshots', { keyPath: 'boardId' });
    request.result
      .createObjectStore('updates', { keyPath: 'seq', autoIncrement: true })
      .createIndex('by-board', 'boardId');
  };
  return new Promise((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

it('keeps old-format duplicates and late writes manual through publication, compaction and deletion', async () => {
  const factory = new IDBFactory();
  const old = await oldWriter(factory);
  const append = async (bytes: Uint8Array): Promise<void> =>
    transact(old, 'readwrite', (transaction) => {
      transaction.objectStore('updates').add({ boardId: 'b', bytes });
      return () => undefined;
    });
  const { relay, offline } = earlierLayoutBoard();
  await append(offline);
  let cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  const recovery = cache.recovery;
  if (recovery === undefined) throw new Error('Missing recovery.');
  expect(
    await recovery.publish('b', await recovery.capture('b'), relay.encodeState(), 'manual'),
  ).toBe(true);
  await append(relay.encodeState());
  expect(await recovery.retained('b')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        generation: -1,
        replayPolicy: 'manual',
        board: { snapshot: undefined, updates: [offline, relay.encodeState()] },
      }),
    ]),
  );
  expect(await cache.compact('b', relay.encodeState())).toBe(true);
  expect(await recovery.publish('b', await recovery.capture('b'), relay.encodeState())).toBe(true);
  await cache.delete('b');
  cache.close();
  cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  if (cache.recovery === undefined) throw new Error('Missing recovery.');
  expect(
    (await cache.recovery.retained('b')).find((source) => source.generation === -1)?.replayPolicy,
  ).toBe('manual');
  const sources = await cache.earlierLayouts.find('b');
  expect(sources).toHaveLength(1);
  expect(sources[0]?.replayPolicy).toBe('manual');
  const store = new YjsDocumentStore();
  const durable = vi.fn(() => Promise.resolve());
  const carry = new LayoutCarryOver({
    store,
    boardId: 'b',
    earlierLayouts: cache.earlierLayouts,
    storeDurably: durable,
  });
  await carry.run(true);
  expect(holdsObject(store, 'offline')).toBe(false);
  expect(durable).not.toHaveBeenCalled();
  expect(carry.stranded).toHaveLength(1);
  await append(new Uint8Array([0, 0]));
  expect((await carry.stranded[0]?.exportSource?.())?.board.updates).toContainEqual(
    new Uint8Array([0, 0]),
  );
  await carry.dismiss(sources[0]?.source ?? '');
  expect(carry.stranded).toHaveLength(1);
  expect(await cache.earlierLayouts.find('b')).toHaveLength(1);
  const later = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
  const laterSources = await later.earlierLayouts.find('b');
  expect(laterSources).toHaveLength(2);
  expect(laterSources.every((source) => source.replayPolicy === 'manual')).toBe(true);
  later.close();
  carry.destroy();
  store.destroy();
  relay.destroy();
  old.close();
  cache.close();
});

it('never passes manual generations to a later-layout converter or recovery candidate', async () => {
  const factory = new IDBFactory();
  const { relay, offline } = earlierLayoutBoard();
  const old = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  await old.append('b', offline);
  if (old.recovery === undefined) throw new Error('Missing recovery.');
  await old.recovery.publish('b', await old.recovery.capture('b'), relay.encodeState(), 'manual');
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
  const store = new YjsDocumentStore();
  const convert = vi.fn((bytes: Uint8Array) => bytes);
  const durable = vi.fn(() => Promise.resolve());
  const carry = new LayoutCarryOver({
    store,
    boardId: 'b',
    earlierLayouts: cache.earlierLayouts,
    converters: new Map([[layoutStepKey(2, 3), convert]]),
    storeDurably: durable,
  });
  await carry.run(true);
  expect(convert).not.toHaveBeenCalled();
  expect(durable).not.toHaveBeenCalled();
  expect(holdsObject(store, 'offline')).toBe(false);
  expect(carry.stranded).toHaveLength(1);
  expect((await cache.earlierLayouts.find('b'))[0]?.board.updates).toContainEqual(offline);
  carry.destroy();
  store.destroy();
  relay.destroy();
  old.close();
  cache.close();
});

it('preserves manual memory archives when ordinary deletion is requested', async () => {
  const cache = new MemoryDocumentCache();
  await cache.append('b', new Uint8Array([1]));
  await cache.recovery.publish(
    'b',
    await cache.recovery.capture('b'),
    new Uint8Array([2]),
    'manual',
  );
  await cache.delete('b');
  expect(await cache.recovery.retained('b')).toEqual([
    expect.objectContaining({
      replayPolicy: 'manual',
      board: { snapshot: undefined, updates: [new Uint8Array([1])] },
    }),
  ]);
  cache.close();
});

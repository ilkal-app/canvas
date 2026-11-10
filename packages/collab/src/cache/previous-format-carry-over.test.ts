import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { poisonedHistory } from '../client/__fixtures__/poisoned-device.js';

import { earlierLayoutBoard, holdsObject } from './__fixtures__/earlier-layout-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { LayoutCarryOver } from './layout-carry-over.js';
import { layoutStepKey } from './layout-converters.js';

async function openOld(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open('canvas-board-cache:layout:2', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('snapshots', { keyPath: 'boardId' });
    request.result
      .createObjectStore('updates', { keyPath: 'seq', autoIncrement: true })
      .createIndex('by-board', 'boardId');
  };
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Open failed.'));
    };
  });
}

async function appendOld(database: IDBDatabase, bytes: Uint8Array): Promise<void> {
  const transaction = database.transaction('updates', 'readwrite');
  transaction.objectStore('updates').add({ boardId: 'b', bytes });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('Write aborted.'));
    };
  });
}

it('restores a late old-tab offline edit on a local-only reopen and retains its source', async () => {
  const factory = new IDBFactory();
  const old = await openOld(factory);
  const { relay, offline } = earlierLayoutBoard();
  await appendOld(old, relay.encodeState());
  const first = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  first.close();
  // The original writer remains usable after the new format has already been created.
  await appendOld(old, offline);
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  const store = new YjsDocumentStore();
  const binding = await DocumentCacheBinding.open({ store, cache, boardId: 'b' });
  expect(holdsObject(store, 'offline')).toBe(false);
  const carry = new LayoutCarryOver({
    store,
    boardId: 'b',
    earlierLayouts: cache.earlierLayouts,
    storeDurably: (update) => cache.append('b', update),
  });
  await carry.run(true);
  expect(holdsObject(store, 'offline')).toBe(true);
  expect(carry.stranded).toEqual([]);
  expect(await cache.earlierLayouts.find('b')).toHaveLength(1);
  await binding.flush();
  binding.destroy();
  const reopened = new YjsDocumentStore();
  const nextBinding = await DocumentCacheBinding.open({ store: reopened, cache, boardId: 'b' });
  expect(holdsObject(reopened, 'offline')).toBe(true);
  nextBinding.destroy();
  reopened.destroy();
  store.destroy();
  relay.destroy();
  old.close();
  cache.close();
});

it('keeps poisoned retained records isolated across a later layout converter', async () => {
  const factory = new IDBFactory();
  const { relay, offline } = earlierLayoutBoard();
  const poison = poisonedHistory();
  relay.applyUpdate(poison.filler, SYSTEM_ORIGIN);
  const old = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  await old.append('b', poison.fragment);
  await old.append('b', offline);
  if (old.recovery === undefined) throw new Error('Missing recovery.');
  await old.recovery.publish('b', await old.recovery.capture('b'), relay.encodeState());
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
  const store = new YjsDocumentStore();
  store.applyUpdate(relay.encodeState(), SYSTEM_ORIGIN);
  const convert = vi.fn((bytes: Uint8Array) => bytes);
  const carry = new LayoutCarryOver({
    store,
    boardId: 'b',
    earlierLayouts: cache.earlierLayouts,
    converters: new Map([[layoutStepKey(2, 3), convert]]),
    storeDurably: (update) => cache.append('b', update),
  });
  await carry.run(true);
  expect(convert).toHaveBeenCalled();
  expect(holdsObject(store, 'offline')).toBe(true);
  expect(holdsObject(store, poison.ghostId)).toBe(false);
  expect(store.hasPendingStructs).toBe(false);
  expect(carry.stranded).toEqual([expect.objectContaining({ unsentChangeCount: 1 })]);
  const unresolved = carry.stranded[0];
  expect(unresolved?.exportSource).toBeDefined();
  if (unresolved === undefined) throw new Error('Missing retained source.');
  await carry.dismiss(unresolved.source);
  expect(carry.stranded).toHaveLength(1);
  expect((await unresolved.exportSource?.())?.board.updates).toContainEqual(poison.fragment);
  const retained = await old.recovery.retained('b');
  expect(retained[0]?.board.updates).toEqual([poison.fragment, offline]);
  expect(await cache.earlierLayouts.find('b')).toHaveLength(1);
  store.destroy();
  relay.destroy();
  old.close();
  cache.close();
});

import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { openIndexedDbCache } from './indexeddb-cache.js';

async function writeLegacy(factory: IDBFactory, name: string): Promise<void> {
  const request = factory.open(name, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('snapshots', { keyPath: 'boardId' });
    request.result
      .createObjectStore('updates', { keyPath: 'seq', autoIncrement: true })
      .createIndex('by-board', 'boardId');
  };
  const database = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const transaction = database.transaction('updates', 'readwrite');
  const legacy = new Y.Doc();
  legacy.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 1 });
  transaction
    .objectStore('updates')
    .add({ boardId: 'board', bytes: Y.encodeStateAsUpdate(legacy) });
  legacy.destroy();
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

it.each([undefined, 'custom-cache'])(
  'isolates legacy bytes from the current writer layout (%s)',
  async (databaseName) => {
    const factory = new IDBFactory();
    await writeLegacy(factory, databaseName ?? 'canvas-board-cache');
    const options = { factory, ...(databaseName === undefined ? {} : { databaseName }) };
    const current = await openIndexedDbCache(options);
    expect(await current.load('board')).toEqual({ snapshot: undefined, updates: [] });
    await current.append('board', new Uint8Array([3]));
    current.close();
    const reopened = await openIndexedDbCache(options);
    expect((await reopened.load('board')).updates).toEqual([new Uint8Array([3])]);
    reopened.close();
  },
);

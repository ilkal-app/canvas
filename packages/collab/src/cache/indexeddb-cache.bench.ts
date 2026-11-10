import { IDBFactory } from 'fake-indexeddb';
import { bench, describe } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

// The offline cache and the first-paint budget (< 500 ms): a cached board must open from
// the device before the network answers. A 10k-object board is stored as the cache holds it
// after use: one snapshot plus a tail of updates (here 200 single-object edits). Each run opens
// a new connection and restores the board into a fresh store. fake-indexeddb runs in Node, so
// this measures the cache's own cost (reads, merge, one applyUpdate), not a browser's disk.
const OBJECT_COUNT = 10_000;
const TAIL_UPDATES = 200;
const BOARD = 'bench-board';

const factory = new IDBFactory();
const writerCache = await openIndexedDbCache({ factory });
const writer = new YjsDocumentStore();
const binding = await DocumentCacheBinding.open({
  store: writer,
  cache: writerCache,
  boardId: BOARD,
  compactEvery: 1_000_000,
});
addStickies(writer, OBJECT_COUNT - TAIL_UPDATES, { seed: 11 });
await binding.compact();
addStickies(writer, TAIL_UPDATES, { seed: 12, batchSize: 1 });
await binding.flush();
binding.destroy();
writerCache.close();

describe(`restoring a cached ${String(OBJECT_COUNT)}-object board (fake-indexeddb)`, () => {
  bench(
    'open the cache and restore into a new store',
    async () => {
      const cache = await openIndexedDbCache({ factory });
      const store = new YjsDocumentStore();
      const restored = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
      if (store.read().objects.size !== OBJECT_COUNT) throw new Error('board not restored');
      restored.destroy();
      store.destroy();
      cache.close();
    },
    { iterations: 10, warmupIterations: 2 },
  );
});

import { IDBFactory } from 'fake-indexeddb';
import { bench, describe } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { benchSize } from './__fixtures__/bench-size.js';
import { addStickies } from './__fixtures__/sticky-board.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

// A compaction's main-thread cost (no frame over 33 ms during a drag with
// remote motion). The binding runs it from an idle callback, as two parts in one task: the
// store's `encodeState` (the long part, which grows with the board) and the cache's compaction
// request, which only stores the snapshot and deletes the covered log, and completes in its own
// IndexedDB transaction. Boards of 10k and 50k stickies: the mobile and desktop budget sizes.
// fake-indexeddb runs in Node, so the write figures are the cache's own overhead, not a disk's.
// CI's smoke run (`BENCH_SMOKE=1`) builds 2k stickies instead of 50k, to fit its heap.
const BOARD = 'bench-board';

for (const objectCount of [10_000, benchSize({ full: 50_000, smoke: 2_000 })]) {
  const store = new YjsDocumentStore();
  addStickies(store, objectCount, { seed: 21, batchSize: 5_000 });
  const cache = await openIndexedDbCache({ factory: new IDBFactory() });
  const snapshot = store.encodeState();

  describe(`compacting a ${String(objectCount)}-object board`, () => {
    bench(
      'encodeState (the idle-time task)',
      () => {
        store.encodeState();
      },
      { iterations: 10, warmupIterations: 2 },
    );
    bench(
      'store the snapshot and delete the log (fake-indexeddb)',
      async () => {
        await cache.append(BOARD, new Uint8Array([0, 0]));
        if (!(await cache.compact(BOARD, snapshot))) throw new Error('compaction refused');
      },
      { iterations: 10, warmupIterations: 2 },
    );
  });
}

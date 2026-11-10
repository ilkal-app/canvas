import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { listAssetIds } from './list-asset-ids.js';

// What the relay pays per snapshot to record a board's assets, on the synthetic board at
// the desktop budget size, beside the cheapest alternative (loading the state into a Y.Doc).
// CI's smoke run (`BENCH_SMOKE=1`) builds a 2k board instead.

const objectCount = benchSize({ full: 50_000, smoke: 2_000 });
const HEAVY = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 };

const source = new YjsDocumentStore();
source.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of createLargeBoardObjects(objectCount, 72)) transaction.setObject(object);
});
const state = source.encodeState();
source.destroy();

describe(`listAssetIds on ${String(objectCount)} objects`, () => {
  bench(
    'listAssetIds: scan the encoded state',
    () => {
      listAssetIds(state);
    },
    HEAVY,
  );

  bench(
    'baseline: Y.applyUpdate into a new Y.Doc (before reading any key)',
    () => {
      new Y.Doc().transact((transaction) => {
        Y.applyUpdate(transaction.doc, state);
      });
    },
    HEAVY,
  );
});

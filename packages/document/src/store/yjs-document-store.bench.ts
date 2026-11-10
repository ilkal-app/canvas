import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { formatMebibytes, measureRetainedHeap } from './__fixtures__/heap-measure.js';
import { countYjsItems } from './__fixtures__/yjs-items.js';
import { YjsDocumentStore } from './yjs-document-store.js';

// Yjs at 50k objects: load time,
// memory and state size of a realistic board (../synthetic/large-board.ts) at the mobile and
// desktop budget sizes, in the grouped-field layout the codec writes, beside the floor of one
// plain value per object. The per-field layout of is no longer read; its
// numbers are in the README. Memory is in the describe titles, in square brackets, which the regression gate
// leaves out of a benchmark's key, because `pnpm bench` reports only times; run
// with `NODE_OPTIONS=--expose-gc` (without it they read n/a). The numbers recorded in the
// README were taken this way; `-t load` runs only the load rows. CI's smoke run
// (`BENCH_SMOKE=1`) builds 1k and 2k boards instead.

const SIZES = [
  benchSize({ full: 10_000, smoke: 1_000 }),
  benchSize({ full: 50_000, smoke: 2_000 }),
];
const HEAVY = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 };

/**
 * Loads an update into a bare `Y.Doc`, measuring the heap it keeps.
 *
 * @param update - The document's state.
 * @returns The heap figure and the Yjs item count.
 */
function measureBareLoad(update: Uint8Array): { heap: string; items: number } {
  const loaded = measureRetainedHeap(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    return doc;
  });
  const items = countYjsItems(loaded.value);
  loaded.value.destroy();
  return { heap: formatMebibytes(loaded.bytes), items };
}

for (const objectCount of SIZES) {
  const objects = createLargeBoardObjects(objectCount, 45);
  const source = new YjsDocumentStore();
  source.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const state = source.encodeState();
  source.destroy();
  const bare = measureBareLoad(state);

  const loaded = measureRetainedHeap(() => {
    const store = new YjsDocumentStore();
    store.applyUpdate(state, SYSTEM_ORIGIN);
    return store;
  });
  const snapshot = measureRetainedHeap(() => loaded.value.read());
  const target = objects[1]?.id ?? ('' as ObjectId);
  let nudge = 0;

  describe(
    `${String(objectCount)} objects, grouped layout [state ` +
      `${formatMebibytes(state.byteLength)}, Y.Doc heap ${bare.heap}, ` +
      `${String(bare.items)} Yjs items; store after load ${formatMebibytes(loaded.bytes)} ` +
      `(Y.Doc and decoded objects), snapshot ${formatMebibytes(snapshot.bytes)}]`,
    () => {
      bench(
        'load: Y.applyUpdate into a new Y.Doc (the CRDT alone)',
        () => {
          Y.applyUpdate(new Y.Doc(), state);
        },
        HEAVY,
      );

      bench(
        'load: new store + applyUpdate (decodes every object for the reference repair)',
        () => {
          new YjsDocumentStore().applyUpdate(state, SYSTEM_ORIGIN);
        },
        HEAVY,
      );

      bench(
        'load and first read(): applyUpdate, then the snapshot',
        () => {
          const store = new YjsDocumentStore();
          store.applyUpdate(state, SYSTEM_ORIGIN);
          store.read();
        },
        HEAVY,
      );

      bench('encodeState of the whole board', () => {
        loaded.value.encodeState();
      });

      bench('transact: patch one object and read() the next snapshot', () => {
        nudge += 1;
        loaded.value.transact(SYSTEM_ORIGIN, (transaction) => {
          transaction.patchObject(target, { x: nudge });
        });
        loaded.value.read();
      });

      bench('transact: patch one object, no read', () => {
        nudge += 1;
        loaded.value.transact(SYSTEM_ORIGIN, (transaction) => {
          transaction.patchObject(target, { x: nudge });
        });
      });
    },
  );
}

const floorObjects = createLargeBoardObjects(SIZES.at(-1) ?? 0, 45);
const oneValueDoc = new Y.Doc();
oneValueDoc.transact(() => {
  const map = oneValueDoc.getMap<unknown>('objects');
  for (const object of floorObjects) map.set(object.id, object);
});
const oneValueState = Y.encodeStateAsUpdate(oneValueDoc);
oneValueDoc.destroy();
const oneValue = measureBareLoad(oneValueState);

describe(
  `${String(floorObjects.length)} objects, each object one plain value (the floor: no ` +
    `per-field merge) [state ${formatMebibytes(oneValueState.byteLength)}, Y.Doc heap ` +
    `${oneValue.heap}, ${String(oneValue.items)} Yjs items]`,
  () => {
    bench(
      'load: Y.applyUpdate into a new Y.Doc, one value per object',
      () => {
        Y.applyUpdate(new Y.Doc(), oneValueState);
      },
      HEAVY,
    );
  },
);

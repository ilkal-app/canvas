import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The related-change case measured on, kept under the micro-benchmark gate.
// Includes a real store change and the first overlay recomputing the selection's scope.
// Network delivery and Yjs decoding are outside this tool CPU measurement.
const OBJECTS = Array.from({ length: 10_000 }, (unused, index) =>
  rect(`r${String(index)}`, null, {
    x: (index % 100) * 50,
    y: Math.floor(index / 100) * 50,
    width: 40,
    height: 40,
  }),
);
const STORE = createSelectStore(OBJECTS);
const CONTROLLER = new SelectController({
  store: STORE,
  origin: ADA,
  environment: ENVIRONMENT,
  hitTester: createSelectHitTester(indexOf(OBJECTS), storeSource(STORE)),
});
CONTROLLER.select(OBJECTS.map(({ id }) => id));
CONTROLLER.overlay();
let changeStep = 0;

describe('board-bound selection costs at 10,000 objects', () => {
  bench('related change set and far-scope recomputation for 10,000 selected objects', () => {
    STORE.transact(ADA, (transaction) => {
      transaction.patchObject('r0' as ObjectId, { x: ++changeStep % 2 });
    });
    CONTROLLER.overlay();
  });
});

import { bench, describe } from 'vitest';

import { compareKeys } from '@canvas/schema';

import { benchSize } from '../store/__fixtures__/bench-size.js';

import { objectId } from './__fixtures__/sibling-board.js';
import { createWideBoard } from './__fixtures__/wide-board.js';
import { keysAtFront, sortedSiblings } from './sibling-order.js';

// Sorting a parent's children by z (the layers panel, and the scene graph's segments)
// on the budget's 50k-object board, all at the root and written in a shuffled order. CI's smoke
// run (`BENCH_SMOKE=1`) uses 2k siblings.

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const { store, keys: plainKeys } = createWideBoard(COUNT);

describe(`${String(COUNT)} siblings`, () => {
  bench('sortedSiblings(store, null)', () => {
    sortedSiblings(store, null);
  });

  bench('sorting the bare keys with compareKeys', () => {
    [...plainKeys].sort(compareKeys);
  });

  bench('keysAtFront(store, null, one id)', () => {
    keysAtFront(store, null, [objectId('new')]);
  });
});

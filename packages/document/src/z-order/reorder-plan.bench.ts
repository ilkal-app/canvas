import { bench, describe } from 'vitest';

import { benchSize } from '../store/__fixtures__/bench-size.js';

import { createWideBoard } from './__fixtures__/wide-board.js';
import { planReorder } from './reorder-plan.js';

// Planning an order move among the budget's 50k siblings (all at the board root): front and
// back take one pass over the siblings, forward and backward sort them. CI's smoke run
// (`BENCH_SMOKE=1`) uses 2k siblings.

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const { store, ids } = createWideBoard(COUNT);
const middle = ids.slice(COUNT / 2, COUNT / 2 + 3);

describe(`planReorder over ${String(COUNT)} root siblings, 3 selected`, () => {
  bench('front', () => {
    planReorder(store, middle, 'front');
  });

  bench('back', () => {
    planReorder(store, middle, 'back');
  });

  bench('forward', () => {
    planReorder(store, middle, 'forward');
  });

  bench('backward', () => {
    planReorder(store, middle, 'backward');
  });
});

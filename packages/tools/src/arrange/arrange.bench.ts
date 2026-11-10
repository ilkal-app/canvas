import { bench, describe } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { rect } from '../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  ENVIRONMENT,
  storeSource,
} from '../select/__fixtures__/select-store.js';

import { planArrange, runArrange, type ArrangeOperation } from './arrange-plan.js';

// CPU cost of the arrange operations with 1,000 objects selected: an alignment is a
// keypress that plans every object's box and runs one `moveObjects` command, all inside one frame.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

/**
 * 1,000 rectangles of mixed sizes on a ragged 40 × 25 grid, a few of them turned.
 *
 * @returns The objects.
 */
function board(): BoardObject[] {
  return [...Array(1000).keys()].map((index) =>
    rect(`r${String(index)}`, null, {
      x: (index % 40) * 60 + (index % 7),
      y: Math.floor(index / 40) * 60 + (index % 5),
      width: 30 + (index % 3) * 10,
      height: 30 + (index % 4) * 5,
      rotation: index % 11 === 0 ? Math.PI / 6 : 0,
    }),
  );
}

const OBJECTS = board();
const IDS = OBJECTS.map(({ id }) => id);
const SOURCE = storeSource(createSelectStore(OBJECTS));
const STORE = createSelectStore(OBJECTS);
const STORE_SOURCE = storeSource(STORE);
let isLeft = true;

/**
 * Plans an operation on the untouched board.
 *
 * @param operation - The operation.
 */
function plan(operation: ArrangeOperation): void {
  planArrange(operation, IDS, SOURCE);
}

describe('arrange, 1,000 objects selected', () => {
  bench('plan align left', () => {
    plan('alignLeft');
  });

  bench('plan distribute horizontally', () => {
    plan('distributeHorizontally');
  });

  bench('plan tidy up', () => {
    plan('tidyUp');
  });

  bench('plan and run align left and align right in turn: one moveObjects command', () => {
    const operation = isLeft ? 'alignLeft' : 'alignRight';
    isLeft = !isLeft;
    const arranged = planArrange(operation, IDS, STORE_SOURCE);
    if (arranged) runArrange(STORE, ADA, ENVIRONMENT, arranged);
  });
});

import { bench, describe } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import { createBoard } from '@canvas/schema';

import { benchSize } from '../panels/__fixtures__/bench-size.js';

import { commentPlacement } from './comment-placement.js';

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const BOARD = createBoard(createLargeBoardObjects(COUNT, 90));
describe(`comment placement on ${String(COUNT)} objects`, () => {
  bench(
    'pick a pin anchor using the painted geometry',
    () => {
      commentPlacement(BOARD, { x: 200, y: 200 });
    },
    { time: 0, iterations: 10, warmupTime: 0, warmupIterations: 1 },
  );
});

import { bench, describe } from 'vitest';

import { benchSize } from './__fixtures__/bench-size.js';
import { randomBox, randomEntries, seededRandom } from './__fixtures__/random-boxes.js';
import { RTree } from './r-tree.js';

// CPU cost of the R-tree at the board size the budgets name (50k objects,
// p95 frame under 12 ms, camera-only frames under 1 ms of CPU). Boxes are up to 100 units wide
// over a 20k × 20k world, about a 1:5 object-to-gap ratio like a busy board; the viewport query is
// a 1600 × 1000 window at zoom 1. CI's smoke run (`BENCH_SMOKE=1`) loads 2k boxes.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const OBJECT_COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const UPDATE_COUNT = 1_000;
const WORLD_SIZE = 20_000;
const ENTRIES = randomEntries(OBJECT_COUNT, 42, WORLD_SIZE, 100);

function loadedTree(): RTree<string> {
  const tree = new RTree<string>();
  tree.bulkLoad(ENTRIES);
  return tree;
}

describe(`RTree, ${String(OBJECT_COUNT)} boxes`, () => {
  bench(`bulk load ${String(OBJECT_COUNT)} boxes (STR)`, () => {
    loadedTree();
  });

  // A board arriving in ten equal batches, as the frame-time bench's 5,000-object chunks do:
  // only a batch at least as large as the tree repacks it (here the first two), the
  // later ones insert one by one.
  const batchCount = 10;
  const batchSize = Math.ceil(OBJECT_COUNT / batchCount);
  bench(`load ${String(OBJECT_COUNT)} boxes in ${String(batchCount)} batches`, () => {
    const tree = new RTree<string>();
    for (let start = 0; start < OBJECT_COUNT; start += batchSize) {
      tree.bulkLoad(ENTRIES.slice(start, start + batchSize));
    }
  });

  bench(`insert ${String(OBJECT_COUNT)} boxes one by one (for comparison)`, () => {
    const tree = new RTree<string>();
    for (const { key, bounds } of ENTRIES) tree.insert(key, bounds);
  });

  const moving = loadedTree();
  const random = seededRandom(7);
  bench(`${String(UPDATE_COUNT)} incremental updates (move to a random box)`, () => {
    for (let index = 0; index < UPDATE_COUNT; index += 1) {
      const key = `b${String(Math.floor(random() * OBJECT_COUNT))}`;
      moving.update(key, randomBox(random, WORLD_SIZE, 100));
    }
  });

  const dragged = loadedTree();
  let step = 0;
  bench(`${String(UPDATE_COUNT)} incremental updates (drag: move by a few units)`, () => {
    step += 1;
    for (let index = 0; index < UPDATE_COUNT; index += 1) {
      const entry = ENTRIES[index];
      if (!entry) continue;
      const offset = (step % 10) - 5;
      dragged.update(entry.key, {
        minX: entry.bounds.minX + offset,
        minY: entry.bounds.minY,
        maxX: entry.bounds.maxX + offset,
        maxY: entry.bounds.maxY,
      });
    }
  });

  const queried = loadedTree();
  let pan = 0;
  bench('viewport query (1600 × 1000 at zoom 1, padded 25%)', () => {
    pan = (pan + 37) % (WORLD_SIZE - 2400);
    queried.searchRect({ minX: pan - 400, minY: pan - 250, maxX: pan + 2000, maxY: pan + 1250 });
  });

  bench('viewport query (whole board, zoom 0.05)', () => {
    queried.searchRect({ minX: -1, minY: -1, maxX: WORLD_SIZE + 200, maxY: WORLD_SIZE + 200 });
  });

  bench('point query', () => {
    pan = (pan + 37) % WORLD_SIZE;
    queried.searchPoint({ x: pan, y: WORLD_SIZE - pan });
  });
});

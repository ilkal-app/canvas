import { bench, describe } from 'vitest';

import { SceneSpatialIndex, type WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from '../select/__fixtures__/bench-size.js';
import { id, mapSource, rect } from '../select/__fixtures__/select-board.js';
import { resizeFrame } from '../select/resize-frame.js';
import { snapTransform, type DragSnapRequest } from '../select/snap-transform.js';

import { snapCandidatesNear } from './snap-candidates.js';

// CPU cost of snapping one drag step with 10,000 objects on screen (input handling shares the
// frame's budget). Budget: every case here under 1 ms a step at 10k on screen. The candidates come
// from two R-tree band queries clipped to the viewport, never a scan; each band keeps its 64
// nearest objects, so the exact work is bounded, and a selection more than half the viewport wide
// or tall (a select-all drag) snaps to no object at all. The widest box that still snaps to
// objects is the worst case: its bands return the most objects to rank. Gated by `pnpm bench:ci`
// like every package's `*.bench.ts` (its micro-benchmark suite).

const SIDE = Math.round(Math.sqrt(benchSize({ full: 10_000, smoke: 1_000 })));

/**
 * `SIDE × SIDE` 40 × 40 rectangles on a 50 world-unit grid, every seventh turned: all of them on
 * screen in {@link VIEWPORT}.
 *
 * @returns The objects.
 */
function board(): BoardObject[] {
  const objects: BoardObject[] = [];
  for (let index = 0; index < SIDE * SIDE; index += 1) {
    const x = (index % SIDE) * 50;
    const y = Math.floor(index / SIDE) * 50;
    const rotation = index % 7 === 0 ? 0.3 : 0;
    objects.push(rect(`r${String(index)}`, null, { x, y, width: 40, height: 40, rotation }));
  }
  return objects;
}

const OBJECTS = board();
const SOURCE = mapSource(OBJECTS);
const INDEX = new SceneSpatialIndex();
const BY_ID = new Map<ObjectId, BoardObject>(OBJECTS.map((object) => [object.id, object]));
INDEX.apply({ created: [...BY_ID.keys()], updated: [], deleted: [], get: (key) => BY_ID.get(key) });
const VIEWPORT: WorldBounds = { minX: -50, minY: -50, maxX: SIDE * 50, maxY: SIDE * 50 };
const MIDDLE = Math.floor(SIDE / 2) * 50;

/**
 * A request for a drag at 100% with the grid showing, moving the given objects.
 *
 * @param movingIds - The dragged objects.
 * @param width - The side of their square frame, world units.
 * @param corner - Where the frame's top-left corner is on both axes, world units.
 * @returns The request, with no box cache.
 */
function request(
  movingIds: readonly ObjectId[],
  width: number,
  corner: number = MIDDLE,
): DragSnapRequest {
  return {
    settings: { isEnabled: true, isGridVisible: true },
    isSuspended: false,
    index: INDEX,
    source: SOURCE,
    // A set, as `DragSnapper` keeps one per gesture.
    movingIds: new Set(movingIds),
    start: { x: corner, y: corner, width, height: width, rotation: 0 },
    zoom: 1,
    viewport: VIEWPORT,
  };
}

/**
 * The same request with the gesture's box cache warm, as every step after a drag's first.
 *
 * @param cold - The request.
 * @returns It with a filled cache.
 */
function warm(cold: DragSnapRequest): DragSnapRequest {
  const boxes = new Map<ObjectId, WorldBounds | null>();
  const warmed = { ...cold, boxes };
  snapTransform(MOVE, warmed);
  return warmed;
}

const MOVE = { type: 'move', delta: { x: 23, y: 17 }, isAxisLocked: false } as const;
const ONE = request([id(`r${String((SIDE / 2) * SIDE + SIDE / 2)}`)], 40);
const BLOCK_IDS: ObjectId[] = [];
for (let row = 0; row < 10; row += 1) {
  for (let column = 0; column < 10; column += 1) {
    const index = (Math.floor(SIDE / 2) + row) * SIDE + Math.floor(SIDE / 2) + column;
    BLOCK_IDS.push(id(`r${String(index)}`));
  }
}
const BLOCK = request(BLOCK_IDS, 490);
/** The widest square block that still snaps to objects: just under half the viewport. */
const WIDEST_SIDE = Math.floor(SIDE / 2) - 1;
const WIDEST_IDS: ObjectId[] = [];
for (let row = 0; row < WIDEST_SIDE; row += 1) {
  for (let column = 0; column < WIDEST_SIDE; column += 1) {
    WIDEST_IDS.push(id(`r${String(row * SIDE + column)}`));
  }
}
const WIDEST = request(WIDEST_IDS, WIDEST_SIDE * 50 - 10, 0);
/** Everything selected and dragged at fit: the frame spans the viewport. */
const EVERYTHING = request(
  OBJECTS.map((object) => object.id),
  SIDE * 50 - 10,
  0,
);
const FROM = { x: MIDDLE, y: MIDDLE, width: 40, height: 40, rotation: 0 };
const RESIZE = {
  type: 'resize',
  handle: 'se',
  delta: { x: 23, y: 17 },
  isProportional: false,
  from: FROM,
  to: resizeFrame(FROM, 'se', { x: 23, y: 17 }, false),
} as const;

const WARM_ONE = warm(ONE);
const WARM_BLOCK = warm(BLOCK);
const WARM_WIDEST = warm(WIDEST);

describe(`snapping a drag step [${String(SIDE * SIDE)} objects on screen]`, () => {
  bench('snapCandidatesNear: the line strips round one object', () => {
    snapCandidatesNear(
      INDEX,
      SOURCE,
      { minX: 1023, minY: 1017, maxX: 1063, maxY: 1057 },
      new Set(),
      {
        viewport: VIEWPORT,
        thresholdWorld: 6,
      },
    );
  });

  bench('the first move step of one object: candidates, their boxes, snap and guides', () => {
    snapTransform(MOVE, ONE);
  });

  bench('a later move step of one object, the boxes met already', () => {
    snapTransform(MOVE, WARM_ONE);
  });

  bench('the first move step of a 10 × 10 block of objects', () => {
    snapTransform(MOVE, BLOCK);
  });

  bench('a later move step of a 10 × 10 block of objects', () => {
    snapTransform(MOVE, WARM_BLOCK);
  });

  bench('a later move step of the widest block that still snaps to objects', () => {
    snapTransform(MOVE, WARM_WIDEST);
  });

  bench('a move step of everything selected, dragged at fit', () => {
    snapTransform(MOVE, EVERYTHING);
  });

  bench('a later resize step of one object by a corner', () => {
    snapTransform(RESIZE, WARM_ONE);
  });
});

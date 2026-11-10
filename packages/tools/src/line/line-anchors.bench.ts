import { bench, describe } from 'vitest';

import { SceneSpatialIndex, type WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from '../select/__fixtures__/bench-size.js';
import { mapSource, rect } from '../select/__fixtures__/select-board.js';
import type { SelectPointer } from '../select/select-input.js';

import { nearestAnchor } from './line-anchors.js';
import { lineEndAt } from './line-end.js';

// CPU cost of snapping one line end per pointer move on a 50,000-object board (input handling
// shares the frame's budget). Budget: under 1 ms a move. The anchor query is one R-tree search of
// the pointer grown by 8 CSS px, never a scan of the board, and measures at most 256 objects
// exactly however many are piled under the pointer (`ANCHOR_CANDIDATES_CAP`); the pile case below
// is its worst. `lineEndAt` adds the edge-and-centre snap (`snapCandidatesNear`, two band queries
// clipped to the viewport) when no anchor is near. Gated by `pnpm bench:ci` like every package's
// `*.bench.ts`.

const COUNT = benchSize({ full: 50_000, smoke: 2_000 });
const SIDE = Math.round(Math.sqrt(COUNT));

/**
 * `SIDE × SIDE` 40 × 40 rectangles on a 50 world-unit grid, every seventh turned, then 500 large
 * boxes piled over one spot.
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
  for (let index = 0; index < 500; index += 1) {
    const at = -2000 - index;
    objects.push(rect(`pile${String(index)}`, null, { x: at, y: at, width: 900, height: 900 }));
  }
  return objects;
}

const OBJECTS = board();
const SOURCE = mapSource(OBJECTS);
const INDEX = new SceneSpatialIndex();
const BY_ID = new Map<ObjectId, BoardObject>(OBJECTS.map((object) => [object.id, object]));
INDEX.apply({ created: [...BY_ID.keys()], updated: [], deleted: [], get: (key) => BY_ID.get(key) });
const MIDDLE = Math.floor(SIDE / 2) * 50;
/** A 1600 × 1000 CSS px view at 100% around the middle of the grid. */
const VIEWPORT: WorldBounds = {
  minX: MIDDLE - 800,
  minY: MIDDLE - 500,
  maxX: MIDDLE + 800,
  maxY: MIDDLE + 500,
};
const NONE = new Set<ObjectId>();

/**
 * A pointer at a world point, zoom 1.
 *
 * @param x - World x.
 * @param y - World y.
 * @returns The pointer.
 */
function pointer(x: number, y: number): SelectPointer {
  return { screen: { x, y }, world: { x, y }, isShiftPressed: false, isModPressed: false };
}

describe(`line end snapping, ${String(SIDE * SIDE)} objects`, () => {
  bench('nearestAnchor beside an edge midpoint', () => {
    nearestAnchor(
      INDEX,
      SOURCE,
      { x: MIDDLE + 42, y: MIDDLE + 21 },
      { zoom: 1, excludedIds: NONE },
    );
  });

  bench('nearestAnchor over 500 piled objects (the cap of 256 measured)', () => {
    nearestAnchor(INDEX, SOURCE, { x: -1700, y: -1700 }, { zoom: 1, excludedIds: NONE });
  });

  bench('lineEndAt between objects (no anchor: edges, centres and grid)', () => {
    lineEndAt(
      pointer(MIDDLE + 45, MIDDLE + 45),
      { x: MIDDLE, y: MIDDLE },
      {
        index: INDEX,
        source: SOURCE,
        excludedIds: NONE,
        zoom: 1,
        snapping: { isEnabled: true, isGridVisible: true },
        viewport: VIEWPORT,
      },
    );
  });
});

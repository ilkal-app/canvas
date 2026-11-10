import { bench } from 'vitest';

import { SceneSpatialIndex, type WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { benchSize } from './__fixtures__/bench-size.js';
import { move } from './__fixtures__/drag-snap-steps.js';
import { id, mapSource, rect } from './__fixtures__/select-board.js';
import { DragSnapper } from './drag-snapper.js';

// One drag of 200 pointer moves over a board with about 2,000 objects in view: what a
// change to drag snapping costs per gesture. Setup is outside the timing.
const SIDE = Math.round(Math.sqrt(benchSize({ full: 10_000, smoke: 1_000 })));
const objects: BoardObject[] = Array.from({ length: SIDE * SIDE }, (unused, index) =>
  rect(`r${String(index)}`, null, {
    x: (index % SIDE) * 50,
    y: Math.floor(index / SIDE) * 50,
    width: 40,
    height: 40,
  }),
);
const byId = new Map<ObjectId, BoardObject>(objects.map((object) => [object.id, object]));
const index = new SceneSpatialIndex();
index.apply({ created: [...byId.keys()], updated: [], deleted: [], get: (key) => byId.get(key) });
const view = Math.min(SIDE, 45) * 50;
const viewport: WorldBounds = { minX: 0, minY: 0, maxX: view, maxY: view };
const dragged = [id('r0')];
const start = { x: 0, y: 0, width: 40, height: 40, rotation: 0 };
const pointer = {
  screen: { x: 20, y: 20 },
  world: { x: 20, y: 20 },
  isShiftPressed: false,
  isModPressed: false,
  isSnapSuspended: false,
};

bench('drag snapper: 200 moves, about 2,000 candidates in view', () => {
  const snapper = new DragSnapper(index, mapSource(objects));
  snapper.follow(pointer, 1, { settings: { isEnabled: true, isGridVisible: false }, viewport });
  for (let step = 1; step <= 200; step += 1)
    snapper.snap(move((step % 40) * 13, (step % 30) * 7), dragged, start);
  snapper.clear();
});

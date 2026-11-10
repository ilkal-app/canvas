import { describe, expect, it } from 'vitest';

import { gridSpacingAt } from '@canvas/engine';

import { indexOf, mapSource, selectBoardObjects } from '../select/__fixtures__/select-board.js';

import { createPenSnapper } from './pen-snapper.js';

const OBJECTS = selectBoardObjects();
const snap = createPenSnapper(indexOf(OBJECTS), mapSource(OBJECTS));
const ON = { isEnabled: true, isGridVisible: false };

describe('createPenSnapper', () => {
  it('snaps a point to a nearby object’s edge within 6 CSS px, with a guide', () => {
    // rect-a spans x 0..100, y 0..50: a point 4 px right of its right edge lands on it.
    const snapped = snap({ x: 104, y: 80 }, { zoom: 1, settings: ON, excludedIds: new Set() });
    expect(snapped.point.x).toBe(100);
    expect(snapped.guides.length).toBeGreaterThan(0);
  });

  it('leaves out the objects excluded, and snaps to the grid when it shows', () => {
    const excluded = new Set(OBJECTS.map(({ id: objectId }) => objectId));
    const alone = snap({ x: 104, y: 80 }, { zoom: 1, settings: ON, excludedIds: excluded });
    expect(alone.point).toEqual({ x: 104, y: 80 });
    const grid = { isEnabled: true, isGridVisible: true };
    const onGrid = snap({ x: 1002, y: 1003 }, { zoom: 1, settings: grid, excludedIds: excluded });
    const spacing = gridSpacingAt(1);
    expect(onGrid.point.x % spacing).toBe(0);
    expect(onGrid.point.y % spacing).toBe(0);
  });
});

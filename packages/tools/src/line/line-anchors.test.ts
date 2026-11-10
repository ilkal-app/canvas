import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  frame,
  id,
  indexOf,
  mapSource,
  rect,
  selectBoardObjects,
} from '../select/__fixtures__/select-board.js';

import {
  ANCHOR_CANDIDATES_CAP,
  ANCHOR_SNAP_PX,
  anchorsOfBox,
  nearestAnchor,
} from './line-anchors.js';

const OBJECTS = selectBoardObjects();
const SOURCE = mapSource(OBJECTS);
const INDEX = indexOf(OBJECTS);
const NONE = new Set<never>();

/**
 * The anchor near a point at a zoom.
 *
 * @param x - The point's x.
 * @param y - Its y.
 * @param zoom - The zoom; 1 by default.
 * @returns The anchor, if any.
 */
function anchorAt(x: number, y: number, zoom = 1) {
  return nearestAnchor(INDEX, SOURCE, { x, y }, { zoom, excludedIds: NONE });
}

describe('anchorsOfBox', () => {
  it('is the centre, then the middle of the top, right, bottom and left edges', () => {
    expect(anchorsOfBox({ x: 0, y: 0, width: 100, height: 50, rotation: 0 })).toEqual([
      { x: 50, y: 25 },
      { x: 50, y: 0 },
      { x: 100, y: 25 },
      { x: 50, y: 50 },
      { x: 0, y: 25 },
    ]);
  });

  it('turns with the box', () => {
    const [centre, top] = anchorsOfBox({
      x: 200,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2,
    });
    expect(centre?.x).toBeCloseTo(175, 9);
    expect(centre?.y).toBeCloseTo(50, 9);
    expect(top?.x).toBeCloseTo(200, 9);
    expect(top?.y).toBeCloseTo(50, 9);
  });
});

describe('nearestAnchor', () => {
  it('lands on an edge midpoint within 8 CSS px, and not beyond', () => {
    expect(ANCHOR_SNAP_PX).toBe(8);
    expect(anchorAt(104, 28)).toEqual({ x: 100, y: 25 });
    expect(anchorAt(109, 25)).toBeUndefined();
  });

  it('lands on an object’s centre', () => {
    expect(anchorAt(47, 22)).toEqual({ x: 50, y: 25 });
  });

  it('reaches further in world units when zoomed out', () => {
    expect(anchorAt(114, 25, 0.5)).toEqual({ x: 100, y: 25 });
    expect(anchorAt(104, 25, 4)).toBeUndefined();
  });

  it('finds the anchors of a turned object on its turned edges', () => {
    const anchor = anchorAt(203, 52);
    expect(anchor?.x).toBeCloseTo(200, 9);
    expect(anchor?.y).toBeCloseTo(50, 9);
  });

  it('offers nothing of an excluded object, nor of a line', () => {
    const excluded = new Set([id('rect-a')]);
    expect(
      nearestAnchor(INDEX, SOURCE, { x: 104, y: 28 }, { zoom: 1, excludedIds: excluded }),
    ).toBeUndefined();
    // line-l's box is (0, 500) to (100, 550): its centre would be (50, 525).
    expect(anchorAt(50, 525)).toBeUndefined();
  });

  it('keeps, of a pile beyond the cap, the objects whose anchors come nearest', () => {
    // Twice the cap of large boxes around the point, whose anchors are all far from it.
    const pile: BoardObject[] = Array.from({ length: ANCHOR_CANDIDATES_CAP * 2 }, (unused, n) =>
      rect(`pile-${String(n)}`, null, { x: -500 - n, y: 500, width: 1000, height: 1000 }),
    );
    // One small box whose top edge midpoint, (20, 1000), is 4 px from the point.
    pile.push(rect('small', null, { x: 10, y: 1000, width: 20, height: 20 }));
    const anchor = nearestAnchor(
      indexOf(pile),
      mapSource(pile),
      { x: 20, y: 996 },
      {
        zoom: 1,
        excludedIds: NONE,
      },
    );
    expect(anchor).toEqual({ x: 20, y: 1000 });
  });

  it('finds a turned square’s edge midpoint under 100 large frames whose boxes rank nearer', () => {
    const square = rect('square', null, {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      rotation: Math.PI / 4,
    });
    const right = anchorsOfBox({ x: 0, y: 0, width: 400, height: 400, rotation: Math.PI / 4 })[2];
    if (!right) throw new Error('no anchor');
    const pointer = { x: right.x + 1, y: right.y + 1 };
    // Each frame's left edge midpoint is 50 px from the pointer: out of reach, but nearer than
    // the square's box's anchors (200 px), which are its corners and centre.
    const frames = Array.from({ length: 100 }, (unused, n) =>
      frame(`frame-${String(n)}`, null, {
        x: pointer.x - 50,
        y: pointer.y - 500,
        width: 1000,
        height: 1000,
      }),
    );
    const objects = [...frames, square];
    const anchor = nearestAnchor(indexOf(objects), mapSource(objects), pointer, {
      zoom: 1,
      excludedIds: NONE,
    });
    expect(anchor?.x).toBeCloseTo(right.x, 9);
    expect(anchor?.y).toBeCloseTo(right.y, 9);
  });

  it('ranks an object the index has no box for last when a pile passes the cap', () => {
    const decoys = Array.from({ length: ANCHOR_CANDIDATES_CAP + 44 }, (unused, n) =>
      rect(`decoy-${String(n)}`, null, { x: -500 - n, y: 500, width: 1000, height: 1000 }),
    );
    const small = rect('small', null, { x: 10, y: 1000, width: 20, height: 20 });
    const objects = [...decoys, small];
    const index = indexOf(objects);
    const unboxed = {
      searchRect: (area: Parameters<typeof index.searchRect>[0]) => index.searchRect(area),
      boundsOf: (key: ObjectId) => (key === small.id ? index.boundsOf(key) : undefined),
    };
    const anchor = nearestAnchor(
      unboxed,
      mapSource(objects),
      { x: 20, y: 996 },
      {
        zoom: 1,
        excludedIds: NONE,
      },
    );
    expect(anchor).toEqual({ x: 20, y: 1000 });
  });

  it('measures what an index without boxes proposes, skipping objects with no geometry', () => {
    const bare = {
      searchRect: (rect: Parameters<typeof INDEX.searchRect>[0]) => [
        id('connector-k'),
        ...INDEX.searchRect(rect),
      ],
    };
    const anchor = nearestAnchor(bare, SOURCE, { x: 104, y: 28 }, { zoom: 1, excludedIds: NONE });
    expect(anchor).toEqual({ x: 100, y: 25 });
  });
});

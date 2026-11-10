import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import { mapSource, rect } from '../select/__fixtures__/select-board.js';

import { strokeObject } from './__fixtures__/draw-tool-context.js';
import {
  ERASER_RADIUS_PX,
  eraserRadius,
  erasedStrokes,
  isStrokeTouched,
  segmentDistance,
  sweepBounds,
  type EraserSweep,
} from './eraser-hits.js';

/** A horizontal stroke 2 wide from (0, 0) to (100, 0), placed at (100, 100). */
const FLAT = strokeObject('flat', [0, 0, 50, 0, 100, 0], { x: 100, y: 100 });

/**
 * A sweep between two points, 8 world units round (zoom 1).
 *
 * @param from - Where it starts.
 * @param to - Where it ends; a dab at `from` when absent.
 * @returns The sweep.
 */
function sweep(from: Point, to: Point = from): EraserSweep {
  return { from, to, radius: eraserRadius(1) };
}

/**
 * The stroke ids a sweep erases on a board of objects, every object a candidate.
 *
 * @param objects - The board.
 * @param path - The sweep.
 * @returns The touched ids.
 */
function erasedOn(objects: readonly BoardObject[], path: EraserSweep): ObjectId[] {
  return erasedStrokes(
    path,
    objects.map((object) => object.id),
    mapSource(objects),
  );
}

describe('eraserRadius', () => {
  it('is 8 CSS px at every zoom, in world units', () => {
    expect(ERASER_RADIUS_PX).toBe(8);
    expect(eraserRadius(1)).toBe(8);
    expect(eraserRadius(2)).toBe(4);
    expect(eraserRadius(0.5)).toBe(16);
  });
});

describe('sweepBounds', () => {
  it('grows the swept segment by the radius', () => {
    expect(sweepBounds({ from: { x: 10, y: 50 }, to: { x: -10, y: 20 }, radius: 5 })).toEqual({
      minX: -15,
      minY: 15,
      maxX: 15,
      maxY: 55,
    });
  });
});

describe('segmentDistance', () => {
  it('is 0 for crossing segments and the nearest end’s distance otherwise', () => {
    expect(segmentDistance({ x: 0, y: -5 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { x: 5, y: 0 })).toBe(
      0,
    );
    expect(segmentDistance({ x: 0, y: 3 }, { x: 0, y: 9 }, { x: -5, y: 0 }, { x: 5, y: 0 })).toBe(
      3,
    );
    expect(segmentDistance({ x: 8, y: 4 }, { x: 8, y: 4 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(5);
  });

  it('is 0 for overlapping collinear segments', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 0 })).toBe(
      0,
    );
  });
});

describe('isStrokeTouched', () => {
  const source = mapSource([FLAT]);

  it('touches within the radius plus half the width of the centre line, and no farther', () => {
    // Reach 8 + 1 = 9 world units above or below the line at y 100.
    expect(isStrokeTouched(FLAT, sweep({ x: 150, y: 108.9 }), source)).toBe(true);
    expect(isStrokeTouched(FLAT, sweep({ x: 150, y: 109.1 }), source)).toBe(false);
    expect(isStrokeTouched(FLAT, sweep({ x: 209, y: 100 }), source)).toBe(true);
    expect(isStrokeTouched(FLAT, sweep({ x: 209.5, y: 100 }), source)).toBe(false);
  });

  it('touches a stroke the swept segment crosses though neither end is near it', () => {
    expect(isStrokeTouched(FLAT, sweep({ x: 150, y: 50 }, { x: 150, y: 150 }), source)).toBe(true);
    expect(isStrokeTouched(FLAT, sweep({ x: 150, y: 50 }, { x: 150, y: 80 }), source)).toBe(false);
  });

  it('reaches a wider stroke from farther', () => {
    const wide = strokeObject('wide', [0, 0, 100, 0], { x: 100, y: 100, width: 20 });
    expect(isStrokeTouched(wide, sweep({ x: 150, y: 117 }), mapSource([wide]))).toBe(true);
    expect(isStrokeTouched(wide, sweep({ x: 150, y: 119 }), mapSource([wide]))).toBe(false);
  });

  it('maps the sweep into a turned stroke’s frame', () => {
    // A quarter turn clockwise: the stroke runs down from (100, 100) to (100, 200).
    const turned = strokeObject('turned', [0, 0, 100, 0], {
      x: 100,
      y: 100,
      rotation: Math.PI / 2,
    });
    const turnedSource = mapSource([turned]);
    expect(isStrokeTouched(turned, sweep({ x: 105, y: 180 }), turnedSource)).toBe(true);
    expect(isStrokeTouched(turned, sweep({ x: 180, y: 105 }), turnedSource)).toBe(false);
  });

  it('places a stroke inside a frame through its parent', () => {
    const frame = { ...rect('frame-f', null, { x: 1000, y: 0, width: 300, height: 300 }) };
    const inner = strokeObject('inner', [0, 0, 100, 0], { parentId: 'frame-f', x: 10, y: 10 });
    const inFrame = mapSource([frame, inner]);
    expect(isStrokeTouched(inner, sweep({ x: 1050, y: 12 }), inFrame)).toBe(true);
    expect(isStrokeTouched(inner, sweep({ x: 50, y: 12 }), inFrame)).toBe(false);
  });

  it('touches a one-point dot around its point', () => {
    const dot = strokeObject('dot', [0, 0], { x: 40, y: 40 });
    expect(isStrokeTouched(dot, sweep({ x: 46, y: 46 }), mapSource([dot]))).toBe(true);
    expect(isStrokeTouched(dot, sweep({ x: 50, y: 50 }), mapSource([dot]))).toBe(false);
  });
});

describe('erasedStrokes', () => {
  it('erases only freehand strokes, never a shape under the eraser', () => {
    const shape = rect('shape', null, { x: 100, y: 90, width: 100, height: 20 });
    expect(erasedOn([shape, FLAT], sweep({ x: 150, y: 100 }))).toEqual(['flat']);
  });

  it('never erases a locked or hidden stroke, or one inside a locked parent', () => {
    const locked = strokeObject('locked', [0, 0, 100, 0], { x: 100, y: 100, isLocked: true });
    const hidden = strokeObject('hidden', [0, 0, 100, 0], { x: 100, y: 100, isHidden: true });
    const parent = rect('parent', null, { x: 0, y: 0, width: 400, height: 400, isLocked: true });
    const inLocked = strokeObject('in-locked', [0, 0, 100, 0], {
      parentId: 'parent',
      x: 100,
      y: 100,
    });
    expect(erasedOn([locked, hidden, parent, inLocked, FLAT], sweep({ x: 150, y: 100 }))).toEqual([
      'flat',
    ]);
  });

  it('never erases a stroke the source does not draw (under a hidden layer)', () => {
    const source = { ...mapSource([FLAT]), isDrawable: () => false };
    expect(erasedStrokes(sweep({ x: 150, y: 100 }), [FLAT.id], source)).toEqual([]);
  });

  it('skips a candidate the document no longer holds', () => {
    expect(erasedStrokes(sweep({ x: 150, y: 100 }), ['gone' as ObjectId], mapSource([]))).toEqual(
      [],
    );
  });
});

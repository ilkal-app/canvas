import { describe, expect, it } from 'vitest';

import type { BoardObject, Rgba, ShapeObject } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { hitPoint } from './hit-point.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';
import { isPointOnShape } from './shape-hit.js';

const TOLERANCE = 4;
const CLEAR: Rgba = [0, 0, 0, 0];
const OUTLINE = { color: [0, 0, 1, 1] as Rgba, width: 4 };

/**
 * A 100 × 60 shape of a kind, filled unless said otherwise.
 *
 * @param kind - The kind.
 * @param fields - Fields to change.
 * @returns The shape.
 */
function shape(kind: ShapeObject['kind'], fields: Partial<ShapeObject> = {}): ShapeObject {
  return shapeObject('s', { kind, width: 100, height: 60, sides: 5, ...fields });
}

/**
 * Whether a point of the shape's frame hits it, at the default tolerance.
 *
 * @param object - The shape.
 * @param x - The point's x, in the shape's frame.
 * @param y - Its y.
 * @returns Whether it hits.
 */
function hits(object: ShapeObject, x: number, y: number): boolean {
  return isPointOnShape(object, { x, y }, TOLERANCE);
}

describe('isPointOnShape, filled', () => {
  it('hits a rectangle inside its box, and a rounded one not in its cut corners', () => {
    expect(hits(shape('rectangle'), 1, 1)).toBe(true);
    expect(hits(shape('rectangle'), 101, 30)).toBe(false);
    const rounded = shape('rectangle', { cornerRadius: 20 });
    expect(hits(rounded, 2, 2)).toBe(false);
    expect(hits(rounded, 20, 2)).toBe(true);
  });

  it('hits an ellipse inside it, not in its box corner', () => {
    expect(hits(shape('ellipse'), 50, 30)).toBe(true);
    expect(hits(shape('ellipse'), 50, 1)).toBe(true);
    expect(hits(shape('ellipse'), 5, 5)).toBe(false);
    expect(hits(shape('ellipse'), 95, 55)).toBe(false);
  });

  it('hits a diamond inside its four edges, not in its box corners', () => {
    expect(hits(shape('diamond'), 50, 30)).toBe(true);
    expect(hits(shape('diamond'), 50, 2)).toBe(true);
    expect(hits(shape('diamond'), 10, 10)).toBe(false);
    expect(hits(shape('diamond'), 90, 50)).toBe(false);
  });

  it('hits a triangle stretched to its box: along its base, not beside its apex', () => {
    const triangle = shape('polygon', { sides: 3 });
    expect(hits(triangle, 2, 59)).toBe(true);
    expect(hits(triangle, 98, 59)).toBe(true);
    expect(hits(triangle, 50, 2)).toBe(true);
    expect(hits(triangle, 10, 5)).toBe(false);
    expect(hits(triangle, 90, 5)).toBe(false);
  });

  it('hits a five-point star on its points and centre, not in the notches between', () => {
    const star = shape('star');
    expect(hits(star, 50, 35)).toBe(true);
    expect(hits(star, 50, 2)).toBe(true);
    // Between the top point and the upper right one, outside the star's inner pentagon.
    expect(hits(star, 72, 10)).toBe(false);
    expect(hits(star, 50, 58)).toBe(false);
  });

  it('reads a fill with alpha 0 as no fill', () => {
    const glass = shape('rectangle', { fill: CLEAR, stroke: OUTLINE });
    expect(hits(glass, 50, 30)).toBe(false);
    expect(hits(glass, 2, 30)).toBe(true);
  });
});

describe('isPointOnShape, unfilled', () => {
  const outlined = shape('ellipse', { fill: null, stroke: OUTLINE });

  it('hits its outline band, give or take the tolerance, and not its inside', () => {
    expect(hits(outlined, 50, 30)).toBe(false);
    expect(hits(outlined, 50, 2)).toBe(true);
    // 3 units outside the top of the outline, within the 4-unit tolerance; then 6 outside.
    expect(hits(outlined, 50, -3)).toBe(true);
    expect(hits(outlined, 50, -6)).toBe(false);
    // The band is 4 wide inside the edge: 7 units in is within the tolerance, 10 is not.
    expect(hits(outlined, 50, 7)).toBe(true);
    expect(hits(outlined, 50, 10)).toBe(false);
  });

  it('hits the outline of a shape with no stroke either, within the tolerance', () => {
    const bare = shape('rectangle', { fill: null, stroke: null });
    expect(hits(bare, 0, 30)).toBe(true);
    expect(hits(bare, 50, 30)).toBe(false);
  });

  it("hits a label's box inside an unfilled shape, where its text is", () => {
    const label = { text: 'Hi', runs: [] };
    const labelled = shape('rectangle', { fill: null, stroke: OUTLINE, label });
    expect(hits(labelled, 50, 30)).toBe(true);
    const star = shape('star', { fill: null, stroke: OUTLINE, label });
    expect(hits(star, 50, 35)).toBe(true);
    expect(hits(star, 72, 10)).toBe(false);
    expect(hits(shape('rectangle', { fill: null, label: { text: '', runs: [] } }), 50, 30)).toBe(
      false,
    );
  });
});

describe('isPointOnShape, aligned outlines', () => {
  it('counts a filled shape’s outline outside its edge as part of it', () => {
    const inside = shape('rectangle', { stroke: OUTLINE });
    const outside = shape('rectangle', { stroke: OUTLINE, strokeAlign: 'outside' });
    const centred = shape('rectangle', { stroke: OUTLINE, strokeAlign: 'center' });
    expect(hits(inside, 50, -3)).toBe(false);
    expect(hits(outside, 50, -3)).toBe(true);
    expect(hits(outside, 50, -5)).toBe(false);
    expect(hits(centred, 50, -1.5)).toBe(true);
    expect(hits(centred, 50, -3)).toBe(false);
  });

  it('hits a filled box’s outline corner where it is drawn: mitred when sharp, grown when rounded', () => {
    // A sharp rectangle's outline outside its edge ends in a square corner (the
    // shader grows the box), so a point 3 px past both edges at the top-left corner is on it.
    const outside = shape('rectangle', { stroke: OUTLINE, strokeAlign: 'outside' });
    expect(hits(outside, -3, -3)).toBe(true);
    expect(hits(outside, -3.9, -3.9)).toBe(true);
    expect(hits(outside, -4.1, -1)).toBe(false);
    expect(hits(outside, 103, 63)).toBe(true);
    const centred = shape('rectangle', { stroke: OUTLINE, strokeAlign: 'center' });
    expect(hits(centred, -1.5, -1.5)).toBe(true);
    expect(hits(centred, -2.5, -1)).toBe(false);
    // A rounded corner's radius grows by the outside part: radius 10 + 4 about (10, 10).
    const rounded = shape('rectangle', {
      cornerRadius: 10,
      stroke: OUTLINE,
      strokeAlign: 'outside',
    });
    const along = 10 - 13.5 / Math.SQRT2;
    expect(hits(rounded, along, along)).toBe(true);
    const beyond = 10 - 14.5 / Math.SQRT2;
    expect(hits(rounded, beyond, beyond)).toBe(false);
    // Inside the edge nothing reaches out: the corner is the box's.
    const inside = shape('rectangle', { stroke: OUTLINE });
    expect(hits(inside, -1, -1)).toBe(false);
  });

  it('hits an unfilled box’s outline at a mitred corner, give or take the tolerance', () => {
    const outside = shape('rectangle', { fill: null, stroke: OUTLINE, strokeAlign: 'outside' });
    // The band's outer corner is (-4, -4), square; the tolerance adds 4 past it, round.
    expect(hits(outside, -6.5, -6.5)).toBe(true);
    expect(hits(outside, -7.5, -7.5)).toBe(false);
    const centred = shape('rectangle', { fill: null, stroke: OUTLINE, strokeAlign: 'center' });
    expect(hits(centred, -4.5, -4.5)).toBe(true);
    expect(hits(centred, -5, -5)).toBe(false);
  });

  it('hits an unfilled shape’s band where it lies about the edge, give or take the tolerance', () => {
    const outside = shape('ellipse', { fill: null, stroke: OUTLINE, strokeAlign: 'outside' });
    // The band is 0 to 4 outside the top edge; the tolerance adds 4 on each side.
    expect(hits(outside, 50, -7)).toBe(true);
    expect(hits(outside, 50, -9)).toBe(false);
    expect(hits(outside, 50, 3)).toBe(true);
    expect(hits(outside, 50, 5)).toBe(false);
    const centred = shape('ellipse', { fill: null, stroke: OUTLINE, strokeAlign: 'center' });
    expect(hits(centred, 50, -5)).toBe(true);
    expect(hits(centred, 50, -7)).toBe(false);
    expect(hits(centred, 50, 5)).toBe(true);
    expect(hits(centred, 50, 7)).toBe(false);
  });
});

describe('hitPoint on shapes', () => {
  function indexed(...objects: BoardObject[]) {
    const document = new FakeSceneDocument();
    document.create(...objects);
    const index = new SceneSpatialIndex();
    index.apply(document.takeChanges());
    return { index, document };
  }

  it('reaches through an unfilled shape to what shows inside it', () => {
    const { index, document } = indexed(
      shapeObject('below', { z: 'a0', x: 20, y: 20, width: 40, height: 40 }),
      shapeObject('frame', { z: 'a1', width: 100, height: 100, fill: null, stroke: OUTLINE }),
    );
    expect(hitPoint(index, document, { x: 40, y: 40 }, { zoom: 1 })).toEqual(['below']);
    expect(hitPoint(index, document, { x: 1, y: 50 }, { zoom: 1 })).toEqual(['frame']);
  });

  it('tests a turned ellipse in its own frame', () => {
    // A 100 × 20 ellipse turned a quarter about its top-left corner (0, 0): it lies along y, left
    // of the origin, from x -20 to 0.
    const { index, document } = indexed(
      shapeObject('turned', { kind: 'ellipse', width: 100, height: 20, rotation: Math.PI / 2 }),
    );
    expect(hitPoint(index, document, { x: -10, y: 50 }, { zoom: 1 })).toEqual(['turned']);
    expect(hitPoint(index, document, { x: -2, y: 5 }, { zoom: 1 })).toEqual([]);
  });

  it('scales the outline tolerance with the zoom', () => {
    const { index, document } = indexed(
      shapeObject('ring', { kind: 'ellipse', width: 100, height: 100, fill: null, stroke: null }),
    );
    // 3 world units outside the outline: within 4 CSS px at 100%, not at 400% (1 unit).
    expect(hitPoint(index, document, { x: 50, y: -3 }, { zoom: 1 })).toEqual(['ring']);
    expect(hitPoint(index, document, { x: 50, y: -3 }, { zoom: 4 })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { frameObject, groupObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SHADOW_SOFTNESS_PER_BLUR } from '../shapes/shape-shadow.js';
import { NOTE_SHADOW } from '../shapes/sticky-note.js';

import {
  commentObject,
  connectorObject,
  lineObject,
  pathObject,
  stickyObject,
} from './__fixtures__/spatial-objects.js';
import { DEFAULT_GEOMETRY_TOLERANCE, objectGeometry } from './object-geometry.js';
import { worldBoundsOf } from './object-world-bounds.js';

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 };

function rotation(angle: number, x = 0, y = 0) {
  return { cos: Math.cos(angle), sin: Math.sin(angle), x, y };
}

function expectBounds(
  actual: ReturnType<typeof worldBoundsOf>,
  expected: { minX: number; minY: number; maxX: number; maxY: number },
) {
  expect(actual).toBeDefined();
  if (!actual) return;
  expect(actual.minX).toBeCloseTo(expected.minX, 9);
  expect(actual.minY).toBeCloseTo(expected.minY, 9);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 9);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 9);
}

describe('worldBoundsOf', () => {
  it('places an unrotated box at its world translation', () => {
    const shape = shapeObject('a', { width: 30, height: 20 });
    expectBounds(worldBoundsOf(shape, { ...IDENTITY, x: 5, y: 7 }), {
      minX: 5,
      minY: 7,
      maxX: 35,
      maxY: 27,
    });
  });

  it('bounds a rotated box by its rotated corners', () => {
    // A 10 × 10 box turned 45° about its top-left corner at (100, 100): a diamond whose
    // corners are at x 100 − 5√2 … 100 + 5√2 and y 100 … 100 + 10√2.
    const shape = shapeObject('a');
    const half = 5 * Math.SQRT2;
    expectBounds(worldBoundsOf(shape, rotation(Math.PI / 4, 100, 100)), {
      minX: 100 - half,
      minY: 100,
      maxX: 100 + half,
      maxY: 100 + 2 * half,
    });
  });

  it('grows a stroked shape by half its stroke and a sticky by its shadow reach', () => {
    const stroked = shapeObject('a', { stroke: { color: [0, 0, 0, 1], width: 4 } });
    expectBounds(worldBoundsOf(stroked, IDENTITY), { minX: -2, minY: -2, maxX: 12, maxY: 12 });
    const reach = NOTE_SHADOW.offsetBottom + NOTE_SHADOW.softness;
    expectBounds(worldBoundsOf(stickyObject('s'), IDENTITY), {
      minX: -reach,
      minY: -reach,
      maxX: 100 + reach,
      maxY: 100 + reach,
    });
    expectBounds(worldBoundsOf(frameObject('f'), IDENTITY), {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
  });

  it('grows a shadowed shape or frame by its shadow’s reach, and no further', () => {
    const shadow: Shadow = { x: 6, y: 8, blur: 5, spread: 2, color: [0, 0, 0, 0.5] };
    const reach = 10 + 2 + SHADOW_SOFTNESS_PER_BLUR * 5;
    expectBounds(worldBoundsOf(shapeObject('a', { shadow }), IDENTITY), {
      minX: -reach,
      minY: -reach,
      maxX: 10 + reach,
      maxY: 10 + reach,
    });
    expectBounds(worldBoundsOf(frameObject('f', { shadow }), IDENTITY), {
      minX: -reach,
      minY: -reach,
      maxX: 100 + reach,
      maxY: 100 + reach,
    });
    // A wide stroke reaches further than a small shadow; a transparent or refused shadow is none.
    const small: Shadow = { x: 0, y: 1, blur: 0, spread: 0, color: [0, 0, 0, 1] };
    const stroked = shapeObject('a', { stroke: { color: [0, 0, 0, 1], width: 8 }, shadow: small });
    expectBounds(worldBoundsOf(stroked, IDENTITY), { minX: -4, minY: -4, maxX: 14, maxY: 14 });
    const clear = { ...shadow, color: [0, 0, 0, 0] as Shadow['color'] };
    expectBounds(worldBoundsOf(frameObject('f', { shadow: clear }), IDENTITY), {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
  });

  it('grows a shape or frame by its outline’s part outside the edge, and its shadow with it', () => {
    const stroke = { color: [0, 0, 0, 1] as Shadow['color'], width: 8 };
    const box = (margin: number, size: number) => ({
      minX: -margin,
      minY: -margin,
      maxX: size + margin,
      maxY: size + margin,
    });
    // Inside: a shape keeps its half-stroke margin, a frame none; centred: half; outside: all.
    expectBounds(worldBoundsOf(shapeObject('a', { stroke }), IDENTITY), box(4, 10));
    expectBounds(worldBoundsOf(frameObject('f', { stroke }), IDENTITY), box(0, 100));
    const centred = { stroke, strokeAlign: 'center' as const };
    expectBounds(worldBoundsOf(frameObject('f', centred), IDENTITY), box(4, 100));
    const outside = { stroke, strokeAlign: 'outside' as const };
    expectBounds(worldBoundsOf(shapeObject('a', outside), IDENTITY), box(8, 10));
    expectBounds(worldBoundsOf(frameObject('f', outside), IDENTITY), box(8, 100));
    // A shadow casts from the outline's outer edge.
    const shadow: Shadow = { x: 0, y: 0, blur: 0, spread: 3, color: [0, 0, 0, 0.5] };
    expectBounds(worldBoundsOf(frameObject('f', { ...outside, shadow }), IDENTITY), box(11, 100));
  });

  it('bounds a line by its points plus its stroke reach, and its heads as drawn', () => {
    expectBounds(worldBoundsOf(lineObject('l'), IDENTITY), {
      minX: -4,
      minY: -4,
      maxX: 104,
      maxY: 4,
    });
    // Width 2: the arrow is capLength(2) = 14 long and 14 wide, its barbs back at x = 86.
    expectBounds(worldBoundsOf(lineObject('l', { endCap: 'arrow' }), IDENTITY), {
      minX: -4,
      minY: -11,
      maxX: 104,
      maxY: 11,
    });
  });

  it('bounds a curved path by its control points, which contain its curves', () => {
    const path = pathObject(
      'p',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      {
        handles: [
          { x: 0, y: -50 },
          { x: 0, y: -50 },
        ],
        strokeWidth: null,
      },
    );
    expectBounds(worldBoundsOf(path, IDENTITY), { minX: 0, minY: -50, maxX: 100, maxY: 0 });
  });

  it('bounds a connector by its route, grown by its stroke', () => {
    const bounds = worldBoundsOf(connectorObject('c'), IDENTITY);
    // The route (0, 0) to (50, 50), grown by two stroke widths of 2.
    expect(bounds?.minX).toBe(-4);
    expect(bounds?.minY).toBe(-4);
    expect(bounds?.maxX).toBeGreaterThanOrEqual(54);
  });

  it('has no bounds for groups, comments and empty paths', () => {
    expect(worldBoundsOf(groupObject('g'), IDENTITY)).toBeUndefined();
    expect(worldBoundsOf(commentObject('m'), IDENTITY)).toBeUndefined();
    expect(worldBoundsOf(pathObject('p', []), IDENTITY)).toBeUndefined();
  });
});

describe('objectGeometry', () => {
  it('routes an elbow line through elbowRoute, as the path pass draws it', () => {
    const line = lineObject('l', {
      route: 'elbow',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ],
    });
    expect(objectGeometry(line)).toMatchObject({
      polylines: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 40, y: 20 },
        ],
      ],
    });
  });

  it('flattens a curved segment and keeps a straight one as one piece', () => {
    const curved = pathObject(
      'p',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      {
        handles: [
          { x: 0, y: -40 },
          { x: 0, y: -40 },
        ],
      },
    );
    const geometry = objectGeometry(curved);
    expect(geometry?.kind).toBe('strokes');
    if (geometry?.kind !== 'strokes') return;
    const [polyline] = geometry.polylines;
    // Flattened as the path pass flattens it: the curve's own midpoint is a vertex (its first
    // split), 3/4 of the way to its handles, y = −30; a finer tolerance takes more points.
    expect(polyline?.find(({ x }) => x === 50)?.y).toBeCloseTo(-30, 9);
    const fine = objectGeometry(curved, DEFAULT_GEOMETRY_TOLERANCE / 10);
    expect(fine?.kind === 'strokes' ? fine.polylines[0]?.length : 0).toBeGreaterThan(
      polyline?.length ?? 0,
    );
    const straight = objectGeometry(
      pathObject('q', [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    );
    expect(straight).toMatchObject({
      polylines: [
        [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      ],
    });
  });

  it('skips a segment whose vertex is missing, which validation reports', () => {
    const path = pathObject('p', [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
    const broken = { ...path, segments: [{ ...path.segments[0], b: 'gone' }] } as typeof path;
    expect(objectGeometry(broken)).toMatchObject({ polylines: [] });
  });
});

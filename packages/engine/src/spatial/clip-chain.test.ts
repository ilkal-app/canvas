import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import {
  frameObject,
  groupObject,
  shapeObject,
  sourceOf,
} from '../scene/__fixtures__/scene-objects.js';

import {
  clipBounds,
  clipChainOf,
  clipCoverageAt,
  clipPolygon,
  clipSegment,
  isInsideClipChain,
  MAX_CLIP_DEPTH,
  type ClipChainMemo,
  type ClipRect,
} from './clip-chain.js';

/**
 * Nested clipping frames, each 10 units inside its parent, and a leaf in the innermost.
 *
 * @param depth - How many frames.
 * @returns The frames, outermost first, then the leaf.
 */
function nestedClips(depth: number): BoardObject[] {
  const frames = Array.from({ length: depth }, (unused, index) =>
    frameObject(`f${String(index)}`, {
      parentId: index === 0 ? null : `f${String(index - 1)}`,
      x: index === 0 ? 0 : 10,
      y: index === 0 ? 0 : 10,
      width: 1000 - 20 * index,
      height: 1000 - 20 * index,
      clip: true,
    }),
  );
  return [...frames, shapeObject('leaf', { parentId: `f${String(depth - 1)}` })];
}

function objectIn(objects: readonly BoardObject[], id: string): BoardObject {
  const found = objects.find((object) => object.id === id);
  if (found === undefined) throw new Error(`No fixture ${id}.`);
  return found;
}

describe('clipChainOf', () => {
  it('is empty for a root object and for children of frames that do not clip', () => {
    const objects = [frameObject('f'), shapeObject('s', { parentId: 'f' })];
    const source = sourceOf(objects);
    expect(clipChainOf(objectIn(objects, 's'), source)).toEqual([]);
    expect(clipChainOf(objectIn(objects, 'f'), source)).toEqual([]);
  });

  it('names a clipping parent with its world placement and size', () => {
    const objects = [
      frameObject('f', { x: 50, y: 20, width: 300, height: 200, clip: true }),
      shapeObject('s', { parentId: 'f' }),
    ];
    expect(clipChainOf(objectIn(objects, 's'), sourceOf(objects))).toEqual([
      { id: 'f', x: 50, y: 20, cos: 1, sin: 0, width: 300, height: 200 },
    ]);
  });

  it('never clips a frame by its own box', () => {
    const objects = [frameObject('f', { clip: true })];
    expect(clipChainOf(objectIn(objects, 'f'), sourceOf(objects))).toEqual([]);
  });

  it('lists nested clips innermost first, passing them through groups', () => {
    const objects = [
      frameObject('outer', { clip: true, width: 500, height: 500 }),
      groupObject('g', { parentId: 'outer', x: 5, y: 5 }),
      frameObject('inner', { parentId: 'g', x: 10, y: 10, clip: true }),
      frameObject('open', { parentId: 'inner' }),
      shapeObject('s', { parentId: 'open' }),
    ];
    const chain = clipChainOf(objectIn(objects, 's'), sourceOf(objects));
    expect(chain.map((rect) => rect.id)).toEqual(['inner', 'outer']);
    expect(chain[0]).toMatchObject({ x: 15, y: 15 });
  });

  it('places a frame in a rotated parent by its world transform', () => {
    const objects = [
      frameObject('outer', { x: 100, y: 0, rotation: Math.PI / 2 }),
      frameObject('inner', { parentId: 'outer', x: 10, y: 0, clip: true }),
      shapeObject('s', { parentId: 'inner' }),
    ];
    const [rect] = clipChainOf(objectIn(objects, 's'), sourceOf(objects));
    expect(rect?.x).toBeCloseTo(100);
    expect(rect?.y).toBeCloseTo(10);
    expect(rect?.cos).toBeCloseTo(0);
    expect(rect?.sin).toBeCloseTo(1);
  });

  it(`keeps the innermost ${String(MAX_CLIP_DEPTH)} clips of a deeper chain`, () => {
    const objects = nestedClips(MAX_CLIP_DEPTH + 2);
    const chain = clipChainOf(objectIn(objects, 'leaf'), sourceOf(objects));
    expect(chain.map((rect) => rect.id)).toEqual(['f9', 'f8', 'f7', 'f6', 'f5', 'f4', 'f3', 'f2']);
  });

  it('answers siblings from the memo with the same chain, without mutating the objects', () => {
    const objects = [
      ...nestedClips(3),
      shapeObject('sibling', { parentId: 'f2' }),
      shapeObject('aunt', { parentId: 'f1' }),
    ];
    const snapshot = structuredClone(objects);
    const source = sourceOf(objects);
    const memo: ClipChainMemo = new Map();
    const first = clipChainOf(objectIn(objects, 'leaf'), source, memo);
    expect(memo.size).toBe(3);
    expect(clipChainOf(objectIn(objects, 'sibling'), source, memo)).toBe(first);
    expect(clipChainOf(objectIn(objects, 'aunt'), source, memo).map((rect) => rect.id)).toEqual([
      'f1',
      'f0',
    ]);
    expect(clipChainOf(objectIn(objects, 'leaf'), source)).toEqual(first);
    expect(objects).toEqual(snapshot);
  });

  it('ends the walk at a missing parent or a parent cycle', () => {
    const cycle = [
      frameObject('a', { parentId: 'b', clip: true }),
      frameObject('b', { parentId: 'a', clip: true }),
      shapeObject('s', { parentId: 'a' }),
    ];
    expect(clipChainOf(objectIn(cycle, 's'), sourceOf(cycle)).map((rect) => rect.id)).toEqual([
      'a',
      'b',
    ]);
    const orphan = [shapeObject('s', { parentId: 'gone' })];
    expect(clipChainOf(objectIn(orphan, 's'), sourceOf(orphan))).toEqual([]);
  });
});

const SQUARE: ClipRect = {
  id: 'f' as ClipRect['id'],
  x: 0,
  y: 0,
  cos: 1,
  sin: 0,
  width: 100,
  height: 100,
};

/** The square turned 45° about its origin: a diamond with its corners at (0, 0) and (0, 141.4). */
const DIAMOND: ClipRect = {
  ...SQUARE,
  id: 'd' as ClipRect['id'],
  cos: Math.SQRT1_2,
  sin: Math.SQRT1_2,
};

describe('isInsideClipChain', () => {
  it('keeps points inside every box, edges included, and drops the rest', () => {
    const inner = { ...SQUARE, id: 'i' as ClipRect['id'], x: 50, y: 50 };
    expect(isInsideClipChain({ x: 75, y: 75 }, [inner, SQUARE])).toBe(true);
    expect(isInsideClipChain({ x: 100, y: 100 }, [inner, SQUARE])).toBe(true);
    expect(isInsideClipChain({ x: 120, y: 75 }, [inner, SQUARE])).toBe(false);
    expect(isInsideClipChain({ x: 25, y: 25 }, [inner, SQUARE])).toBe(false);
    expect(isInsideClipChain({ x: -500, y: 0 }, [])).toBe(true);
  });

  it('tests a rotated box exactly', () => {
    expect(isInsideClipChain({ x: 0, y: 70 }, [DIAMOND])).toBe(true);
    expect(isInsideClipChain({ x: 60, y: 10 }, [DIAMOND])).toBe(false);
  });
});

describe('clipCoverageAt', () => {
  it('fades over one device pixel centred on the edge, like an SDF edge', () => {
    expect(clipCoverageAt({ x: 50, y: 50 }, [SQUARE], 1)).toBe(1);
    expect(clipCoverageAt({ x: 100, y: 50 }, [SQUARE], 1)).toBe(0.5);
    expect(clipCoverageAt({ x: 100.25, y: 50 }, [SQUARE], 1)).toBe(0.25);
    expect(clipCoverageAt({ x: 100.25, y: 50 }, [SQUARE], 0.25)).toBe(0);
    expect(clipCoverageAt({ x: 200, y: 50 }, [SQUARE], 1)).toBe(0);
  });

  it('takes the nearest edge over the whole chain and is 1 for an empty chain', () => {
    const inner = { ...SQUARE, id: 'i' as ClipRect['id'], x: 50 };
    expect(clipCoverageAt({ x: 50, y: 50 }, [inner, SQUARE], 1)).toBe(0.5);
    expect(clipCoverageAt({ x: 1e9, y: 0 }, [], 1)).toBe(1);
  });
});

function expectBounds(actual: WorldBounds | undefined, expected: WorldBounds): void {
  expect(actual).toBeDefined();
  expect(actual?.minX).toBeCloseTo(expected.minX, 9);
  expect(actual?.minY).toBeCloseTo(expected.minY, 9);
  expect(actual?.maxX).toBeCloseTo(expected.maxX, 9);
  expect(actual?.maxY).toBeCloseTo(expected.maxY, 9);
}

describe('clipBounds', () => {
  it('cuts axis-aligned bounds by an axis-aligned box', () => {
    expectBounds(clipBounds({ minX: 50, minY: -20, maxX: 150, maxY: 40 }, [SQUARE]), {
      minX: 50,
      minY: 0,
      maxX: 100,
      maxY: 40,
    });
  });

  it('returns the bounds unchanged for an empty chain and undefined when nothing is left', () => {
    const bounds = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
    expect(clipBounds(bounds, [])).toEqual(bounds);
    expect(clipBounds({ minX: 200, minY: 0, maxX: 300, maxY: 50 }, [SQUARE])).toBeUndefined();
  });

  it('cuts by a rotated clip exactly, not by its bounding box', () => {
    // A strip along the top of the diamond's bounds: inside the diamond only near its top tip.
    expectBounds(clipBounds({ minX: -100, minY: 0, maxX: 100, maxY: 10 }, [DIAMOND]), {
      minX: -10,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
    // Inside the diamond's bounding box but outside the diamond itself.
    expect(clipBounds({ minX: 60, minY: 0, maxX: 70, maxY: 5 }, [DIAMOND])).toBeUndefined();
  });

  it('cuts a rotated shape by the intersection of nested clips', () => {
    const inner = { ...SQUARE, id: 'i' as ClipRect['id'], x: 50, y: 50 };
    const turned = {
      transform: { x: 40, y: 40, cos: Math.SQRT1_2, sin: Math.SQRT1_2 },
      width: 200,
      height: 10,
    };
    // A band along the diagonal, so the overlap [50, 100]² keeps it from corner to corner.
    expectBounds(clipBounds(turned, [inner, SQUARE]), { minX: 50, minY: 50, maxX: 100, maxY: 100 });
    expect(clipBounds(turned, [{ ...inner, x: -60, y: 200 }])).toBeUndefined();
  });

  it('does not mutate the shape or the chain', () => {
    const bounds = { minX: 50, minY: -20, maxX: 150, maxY: 40 };
    const chain = [SQUARE, DIAMOND];
    const snapshot = structuredClone({ bounds, chain });
    clipBounds(bounds, chain);
    expect({ bounds, chain }).toEqual(snapshot);
  });
});

describe('clipPolygon', () => {
  it('cuts a convex polygon by every box of a chain, rotated ones exactly', () => {
    const strip = [
      { x: -100, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: -100, y: 10 },
    ];
    const cut = clipPolygon(strip, [DIAMOND]);
    expect(Math.min(...cut.map(({ x }) => x))).toBeCloseTo(-10, 9);
    expect(Math.max(...cut.map(({ x }) => x))).toBeCloseTo(10, 9);
    expect(clipPolygon(strip, [])).toEqual(strip);
    expect(clipPolygon(strip, [{ ...SQUARE, y: 50 }])).toEqual([]);
  });
});

describe('clipSegment', () => {
  it('keeps the piece of a segment inside every box of a chain', () => {
    const inner = { ...SQUARE, id: 'i' as ClipRect['id'], x: 50 };
    const piece = clipSegment({ x: -50, y: 20 }, { x: 250, y: 20 }, [inner, SQUARE]);
    expect(piece?.[0].x).toBeCloseTo(50, 9);
    expect(piece?.[1].x).toBeCloseTo(100, 9);
    expect(piece?.[0].y).toBeCloseTo(20, 9);
  });

  it('cuts by a rotated box and drops a segment that misses the chain', () => {
    // Along y = 10 the diamond spans x in [-10, 10].
    const piece = clipSegment({ x: -100, y: 10 }, { x: 100, y: 10 }, [DIAMOND]);
    expect(piece?.[0].x).toBeCloseTo(-10, 9);
    expect(piece?.[1].x).toBeCloseTo(10, 9);
    expect(clipSegment({ x: 60, y: 0 }, { x: 70, y: 5 }, [DIAMOND])).toBeUndefined();
  });

  it('keeps a point segment only when the point is inside, and an empty chain keeps all', () => {
    expect(clipSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, [SQUARE])).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(clipSegment({ x: 500, y: 5 }, { x: 500, y: 5 }, [SQUARE])).toBeUndefined();
    expect(clipSegment({ x: -1e6, y: 0 }, { x: 1e6, y: 0 }, [])).toEqual([
      { x: -1e6, y: 0 },
      { x: 1e6, y: 0 },
    ]);
  });
});

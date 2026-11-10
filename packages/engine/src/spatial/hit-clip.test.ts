import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, PathObject, Point } from '@canvas/schema';

import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { lineObject, pathObject } from './__fixtures__/spatial-objects.js';
import { hitPoint } from './hit-point.js';
import { hitRect } from './hit-rect.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';
import type { SpatialSearch } from './spatial-search.js';

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  // An index that proposes everything, so the hit tests' own clip checks are what decide.
  const everything: SpatialSearch = { searchRect: () => objects.map(({ id }) => id) };
  return { index, document, everything };
}

/**
 * A clipping frame "p" over [0, 100]²: a child "s" overflowing its right edge (x 80..120,
 * y 10..20), a line "l" across it at y 40 (x 50..150), a nested clipping frame "q" over
 * [50, 150]² holding "leaf" (x 80..120, y 80..120), and a group "g" holding "gs" (x 90..130,
 * y 60..70).
 *
 * @returns The objects.
 */
function clippedBoard(): BoardObject[] {
  return [
    frameObject('p', { clip: true }),
    shapeObject('s', { parentId: 'p', x: 80, y: 10, width: 40, height: 10 }),
    lineObject('l', { parentId: 'p', x: 50, y: 40 }),
    frameObject('q', { parentId: 'p', x: 50, y: 50, clip: true }),
    shapeObject('leaf', { parentId: 'q', x: 30, y: 30, width: 40, height: 40 }),
    groupObject('g', { parentId: 'p', x: 90, y: 60 }),
    shapeObject('gs', { parentId: 'g', width: 40, height: 10 }),
  ];
}

const sorted = (ids: readonly ObjectId[]): string[] => [...ids].sort();

/**
 * An axis-aligned square's corners, clockwise from its top-left.
 *
 * @param min - Its top-left corner's x and y.
 * @param max - Its bottom-right corner's x and y.
 * @returns The corners.
 */
function square(min: number, max: number): Point[] {
  return [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
  ];
}

/**
 * A filled path of two closed loops, an outline and a hole in it (even-odd), in frame "p".
 *
 * @param id - The path's id.
 * @param outer - The outline's corners.
 * @param hole - The hole's corners.
 * @returns The path.
 */
function ringPath(id: string, outer: readonly Point[], hole: readonly Point[]): PathObject {
  const first = pathObject(id, outer, { isClosed: true, isFilled: true }, { parentId: 'p' });
  const second = pathObject(id, hole, { isClosed: true, isFilled: true });
  const offset = outer.length;
  const rename = (vertex: string) => `v${String(Number(vertex.slice(1)) + offset)}`;
  return {
    ...first,
    vertices: [
      ...first.vertices,
      ...second.vertices.map((vertex) => ({ ...vertex, id: rename(vertex.id) })),
    ],
    segments: [
      ...first.segments,
      ...second.segments.map((segment, index) => ({
        ...segment,
        id: `s${String(index + offset)}`,
        a: rename(segment.a),
        b: rename(segment.b),
      })),
    ],
  };
}
const AT_ZOOM_1 = { zoom: 1, tolerancePx: 0 };

describe('hitPoint through clipping frames', () => {
  it('hits a child where it shows and misses it where its frame clips it away', () => {
    const { index, document, everything } = indexed(...clippedBoard());
    for (const search of [index, everything]) {
      const at = (x: number, y: number) => sorted(hitPoint(search, document, { x, y }, AT_ZOOM_1));
      expect(at(90, 15)).toEqual(['p', 's']);
      expect(at(110, 15)).toEqual([]);
      expect(at(90, 40)).toEqual(['l', 'p']);
      expect(at(120, 40)).toEqual([]);
      // Nested clips intersect; the nested frame's own body is clipped by its parent.
      expect(at(95, 95)).toEqual(['leaf', 'p', 'q']);
      expect(at(110, 110)).toEqual([]);
      expect(at(120, 60)).toEqual([]);
      // Groups pass the clip through.
      expect(at(95, 65)).toEqual(['gs', 'p', 'q']);
      expect(at(110, 65)).toEqual([]);
    }
  });

  it('cuts by a turned clipping frame exactly', () => {
    // Turned 90°, the frame covers world x −100..0, y 0..100; the child shows at y 90..100.
    const { index, document } = indexed(
      frameObject('p', { clip: true, rotation: Math.PI / 2 }),
      shapeObject('s', { parentId: 'p', x: 90, y: 0, width: 40, height: 10 }),
    );
    expect(sorted(hitPoint(index, document, { x: -5, y: 95 }, AT_ZOOM_1))).toEqual(['p', 's']);
    expect(hitPoint(index, document, { x: -5, y: 110 }, AT_ZOOM_1)).toEqual([]);
  });

  it('keeps only the innermost eight clips, as the shaders do', () => {
    const frames = Array.from({ length: 9 }, (unused, level) =>
      frameObject(`f${String(level)}`, {
        parentId: level === 0 ? null : `f${String(level - 1)}`,
        width: level === 0 ? 50 : 1000,
        height: level === 0 ? 50 : 1000,
        clip: true,
      }),
    );
    const { everything, document } = indexed(
      ...frames,
      shapeObject('leaf', { parentId: 'f8', x: 100, y: 100 }),
    );
    // The leaf's chain is f8..f1, so f0 does not cut it; f8's is f7..f0, so f0 does.
    expect(hitPoint(everything, document, { x: 105, y: 105 }, AT_ZOOM_1)).toEqual(['leaf']);
  });
});

describe('hitRect through clipping frames', () => {
  it('does not select by hidden overflow, in either mode', () => {
    const { index, document, everything } = indexed(...clippedBoard());
    const overflow = { minX: 105, minY: 5, maxX: 130, maxY: 25 };
    for (const search of [index, everything]) {
      expect(hitRect(search, document, overflow, 'intersect')).toEqual([]);
      expect(hitRect(search, document, overflow, 'contain')).toEqual([]);
      expect(
        hitRect(search, document, { minX: 110, minY: 35, maxX: 140, maxY: 45 }, 'intersect'),
      ).toEqual([]);
    }
  });

  it('selects by the visible part: touching it, or containing all of it', () => {
    const { index, document } = indexed(...clippedBoard());
    const touching = { minX: 95, minY: 5, maxX: 130, maxY: 25 };
    expect(sorted(hitRect(index, document, touching, 'intersect'))).toEqual(['p', 's']);
    // The visible part of "s" is x 80..100: a marquee around it contains "s", overflow or not.
    const aroundVisible = { minX: 75, minY: 5, maxX: 105, maxY: 25 };
    expect(hitRect(index, document, aroundVisible, 'contain')).toEqual(['s']);
    const partOfVisible = { minX: 85, minY: 5, maxX: 105, maxY: 25 };
    expect(hitRect(index, document, partOfVisible, 'contain')).toEqual([]);
    // The line shows from x 50 to 100.
    const aroundLine = { minX: 45, minY: 35, maxX: 105, maxY: 45 };
    expect(hitRect(index, document, aroundLine, 'contain')).toEqual(['l']);
    const aroundLeaf = { minX: 75, minY: 75, maxX: 101, maxY: 101 };
    expect(hitRect(index, document, aroundLeaf, 'contain')).toContain('leaf');
  });

  it('selects a filled path by the fill the clip keeps, and a stroke only where it shows', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];
    const { everything, document } = indexed(
      frameObject('p', { clip: true }),
      pathObject('fill', square, { isClosed: true, isFilled: true }, { parentId: 'p' }),
      pathObject(
        'shown',
        [
          { x: 47, y: 5 },
          { x: 53, y: 5 },
        ],
        {},
        { parentId: 'p' },
      ),
      pathObject(
        'hidden',
        [
          { x: 147, y: 5 },
          { x: 153, y: 5 },
        ],
        {},
        { parentId: 'p' },
      ),
    );
    const select = (minX: number, minY: number, size: number, mode: 'intersect' | 'contain') =>
      hitRect(everything, document, { minX, minY, maxX: minX + size, maxY: minY + size }, mode);
    expect(select(40, 40, 20, 'intersect')).toEqual(['fill', 'p']);
    expect(select(140, 140, 20, 'intersect')).toEqual([]);
    expect(select(45, 0, 10, 'contain')).toEqual(['shown']);
    expect(select(145, 0, 10, 'contain')).toEqual([]);
    expect(select(145, 0, 10, 'intersect')).toEqual([]);
  });

  it('contains a filled path whose outline is all clipped away by the fill that shows', () => {
    // The fill covers the whole frame; none of its outline survives the clip.
    const { everything, document } = indexed(
      frameObject('p', { clip: true }),
      pathObject('fill', square(-100, 200), { isClosed: true, isFilled: true }, { parentId: 'p' }),
    );
    const select = (
      rect: { minX: number; minY: number; maxX: number; maxY: number },
      mode: 'intersect' | 'contain',
    ) => hitRect(everything, document, rect, mode);
    expect(select({ minX: -5, minY: -5, maxX: 105, maxY: 105 }, 'contain')).toContain('fill');
    expect(select({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 'contain')).toContain('fill');
    // Part of the visible fill is outside the marquee.
    expect(select({ minX: -5, minY: -5, maxX: 60, maxY: 105 }, 'contain')).not.toContain('fill');
    // Touching the visible fill at the clip's edge, the marquee's centre outside the clip.
    expect(select({ minX: 90, minY: 40, maxX: 130, maxY: 60 }, 'intersect')).toContain('fill');
    expect(select({ minX: 40, minY: -30, maxX: 60, maxY: 4 }, 'intersect')).toContain('fill');
    // Over hidden fill only.
    expect(select({ minX: 110, minY: 40, maxX: 130, maxY: 60 }, 'intersect')).toEqual([]);
  });

  it('selects nothing of an even-odd fill whose hole covers what the clip shows', () => {
    const { everything, document } = indexed(
      frameObject('p', { clip: true }),
      ringPath('ring', square(-200, 300), square(-100, 200)),
    );
    const around = { minX: -5, minY: -5, maxX: 105, maxY: 105 };
    expect(hitRect(everything, document, around, 'contain')).not.toContain('ring');
    expect(hitRect(everything, document, around, 'intersect')).not.toContain('ring');
    expect(hitPoint(everything, document, { x: 50, y: 50 }, AT_ZOOM_1)).not.toContain('ring');
  });

  it('selects and hits an even-odd fill by the part that shows, never its hole', () => {
    // The hole covers x 50..200 of the frame, so the fill shows at x 0..50 only.
    const hole = [
      { x: 50, y: -100 },
      { x: 200, y: -100 },
      { x: 200, y: 200 },
      { x: 50, y: 200 },
    ];
    const { everything, document } = indexed(
      frameObject('p', { clip: true }),
      ringPath('ring', square(-200, 300), hole),
    );
    const select = (
      minX: number,
      minY: number,
      maxX: number,
      maxY: number,
      mode: 'intersect' | 'contain',
    ) => hitRect(everything, document, { minX, minY, maxX, maxY }, mode);
    expect(select(-5, -5, 55, 105, 'contain')).toContain('ring');
    expect(select(-5, -5, 40, 105, 'contain')).not.toContain('ring');
    expect(select(60, 40, 90, 60, 'intersect')).not.toContain('ring');
    expect(select(30, 40, 70, 60, 'intersect')).toContain('ring');
    // At the clip's left edge, the marquee's centre outside the clip.
    expect(select(-30, 40, 10, 60, 'intersect')).toContain('ring');
    const at = (x: number, y: number) => hitPoint(everything, document, { x, y }, AT_ZOOM_1);
    expect(at(25, 50)).toContain('ring');
    expect(at(75, 50)).not.toContain('ring');
    // Fill, but outside the clip.
    expect(at(250, 50)).not.toContain('ring');
  });
});

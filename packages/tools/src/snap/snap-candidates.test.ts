import { describe, expect, it } from 'vitest';

import type { SpatialSearch, WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import {
  id,
  indexOf,
  mapSource,
  rect,
  selectBoardObjects,
} from '../select/__fixtures__/select-board.js';

import { SNAP_CANDIDATES_PER_BAND, snapCandidatesNear } from './snap-candidates.js';

const OBJECTS = selectBoardObjects();
const SOURCE = mapSource(OBJECTS);
const INDEX = indexOf(OBJECTS);
const WHOLE_BOARD: WorldBounds = { minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 };
/** A 50 × 50 box below rect-a, level with frame-f. */
const BOX: WorldBounds = { minX: 0, minY: 120, maxX: 50, maxY: 170 };

function sorted(boxes: readonly WorldBounds[]): WorldBounds[] {
  return [...boxes].sort((first, second) => first.minX - second.minX || first.minY - second.minY);
}

describe('snapCandidatesNear', () => {
  it('finds the objects level with the box on either axis, as their boxes', () => {
    const candidates = snapCandidatesNear(INDEX, SOURCE, BOX, new Set(), {
      viewport: WHOLE_BOARD,
      thresholdWorld: 6,
    });
    expect(sorted(candidates)).toEqual([
      { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      { minX: 0, minY: 300, maxX: 40, maxY: 340 },
      { minX: 0, minY: 500, maxX: 100, maxY: 550 },
      { minX: 400, minY: 0, maxX: 700, maxY: 200 },
    ]);
  });

  it('bounds a turned object by its turned corners', () => {
    const level = { minX: 500, minY: 90, maxX: 520, maxY: 95 };
    const candidates = snapCandidatesNear(INDEX, SOURCE, level, new Set([id('frame-f')]), {
      viewport: WHOLE_BOARD,
      thresholdWorld: 6,
    });
    expect(candidates).toContainEqual({ minX: 150, minY: 0, maxX: 200, maxY: 100 });
  });

  it('keeps to the viewport', () => {
    const candidates = snapCandidatesNear(INDEX, SOURCE, BOX, new Set(), {
      viewport: { minX: -1000, minY: -1000, maxX: 300, maxY: 1000 },
      thresholdWorld: 6,
    });
    expect(candidates).not.toContainEqual({ minX: 400, minY: 0, maxX: 700, maxY: 200 });
    expect(candidates).toHaveLength(3);
  });

  it('leaves out the moving objects and everything inside them', () => {
    const candidates = snapCandidatesNear(
      INDEX,
      SOURCE,
      BOX,
      new Set([id('rect-a'), id('group-g')]),
      {
        viewport: WHOLE_BOARD,
        thresholdWorld: 6,
      },
    );
    expect(sorted(candidates)).toEqual([
      { minX: 0, minY: 500, maxX: 100, maxY: 550 },
      { minX: 400, minY: 0, maxX: 700, maxY: 200 },
    ]);
  });

  it('asks the index for a strip through each of the box’s lines and uses only what it answers', () => {
    const queries: WorldBounds[] = [];
    const index: SpatialSearch = {
      searchRect(rect) {
        queries.push(rect);
        return [id('rect-a')] as readonly ObjectId[];
      },
    };
    const viewport = { minX: -100, minY: -200, maxX: 900, maxY: 800 };
    const candidates = snapCandidatesNear(index, SOURCE, BOX, new Set(), {
      viewport,
      thresholdWorld: 6,
    });
    expect(candidates).toEqual([{ minX: 0, minY: 0, maxX: 100, maxY: 50 }]);
    // A strip within reach of each of the box's lines: x 0, 25, 50, then y 120, 145, 170.
    expect(queries).toEqual([
      { minX: -6, minY: -200, maxX: 6, maxY: 800 },
      { minX: 19, minY: -200, maxX: 31, maxY: 800 },
      { minX: 44, minY: -200, maxX: 56, maxY: 800 },
      { minX: -100, minY: 114, maxX: 900, maxY: 126 },
      { minX: -100, minY: 139, maxX: 900, maxY: 151 },
      { minX: -100, minY: 164, maxX: 900, maxY: 176 },
    ]);
  });

  it('keeps only the nearest objects of a crowded band, by how near their lines come', () => {
    // 200 rectangles in the vertical band, the i-th with its lines i/4 from the box's.
    const crowd = [...Array(200).keys()].map((i) =>
      rect(`r${String(i)}`, null, { x: 100 + i / 4, y: 1000 + i * 20, width: 10, height: 10 }),
    );
    const ids = crowd.map((object) => object.id);
    const index: SpatialSearch = {
      searchRect: (band) => (band.minX > -1000 ? ids : []),
    };
    const candidates = snapCandidatesNear(
      index,
      mapSource(crowd),
      { minX: 100, minY: 0, maxX: 110, maxY: 10 },
      new Set(),
      { viewport: WHOLE_BOARD, thresholdWorld: 6 },
    );
    expect(candidates).toHaveLength(SNAP_CANDIDATES_PER_BAND);
    expect(Math.max(...candidates.map(({ minX }) => minX))).toBe(100 + 63 / 4);
    // The same crowd farthest first: each nearer one replaces the farthest kept.
    const reversed: SpatialSearch = {
      searchRect: (band) => (band.minX > -1000 ? [...ids].reverse() : []),
    };
    const fromFar = snapCandidatesNear(
      reversed,
      mapSource(crowd),
      { minX: 100, minY: 0, maxX: 110, maxY: 10 },
      new Set(),
      { viewport: WHOLE_BOARD, thresholdWorld: 6 },
    );
    expect(fromFar.map(({ minX }) => minX).sort((a, b) => a - b)).toEqual(
      candidates.map(({ minX }) => minX).sort((a, b) => a - b),
    );
  });

  it('ranks by the index’s own boxes when it keeps them', () => {
    const asked: string[] = [];
    const index = {
      searchRect: () => [id('rect-a')],
      boundsOf: (objectId: ObjectId) => {
        asked.push(objectId);
        return { minX: 0, minY: 0, maxX: 100, maxY: 50 };
      },
    };
    snapCandidatesNear(index, SOURCE, BOX, new Set(), { viewport: WHOLE_BOARD, thresholdWorld: 6 });
    expect(asked).toEqual(['rect-a', 'rect-a']);
  });

  it('finds no object for a box more than half as wide or tall as the viewport', () => {
    const viewport = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const query = { viewport, thresholdWorld: 6 };
    const wide = { minX: 0, minY: 120, maxX: 501, maxY: 170 };
    expect(snapCandidatesNear(INDEX, SOURCE, wide, new Set(), query)).toEqual([]);
    const tall = { minX: 0, minY: 0, maxX: 50, maxY: 501 };
    expect(snapCandidatesNear(INDEX, SOURCE, tall, new Set(), query)).toEqual([]);
    expect(snapCandidatesNear(INDEX, SOURCE, BOX, new Set(), query).length).toBeGreaterThan(0);
  });
});

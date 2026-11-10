import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import {
  connectorObject,
  imageObject,
  lineObject,
  pathObject,
} from './__fixtures__/spatial-objects.js';
import { hitRect } from './hit-rect.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { index, document };
}

describe('hitRect', () => {
  it('selects what the marquee touches, or only what it wholly contains', () => {
    const { index, document } = indexed(...nestedBoard());
    // f-a's world box is x 90..100, y 110..120, inside the frame (x 0..100, y 100..200).
    const marquee = { minX: 85, minY: 105, maxX: 105, maxY: 125 };
    expect(hitRect(index, document, marquee, 'intersect')).toEqual(['f-a', 'f']);
    expect(hitRect(index, document, marquee, 'contain')).toEqual(['f-a']);
    const everything = { minX: -10, minY: -10, maxX: 6000, maxY: 6000 };
    expect(hitRect(index, document, everything, 'contain')).toHaveLength(5);
  });

  it('tests a rotated box exactly, so the corner of its bounds is not enough', () => {
    const { index, document } = indexed(...nestedBoard());
    // "r" is a diamond with vertices (300, 0), (307.07, 7.07), (300, 14.14), (292.93, 7.07).
    const inBoundsCorner = { minX: 305, minY: 0, maxX: 310, maxY: 2 };
    expect(hitRect(index, document, inBoundsCorner, 'intersect')).toEqual([]);
    const overRightVertex = { minX: 306, minY: 6, maxX: 310, maxY: 8 };
    expect(hitRect(index, document, overRightVertex, 'intersect')).toEqual(['r']);
    const aroundIt = { minX: 290, minY: -1, maxX: 310, maxY: 15 };
    expect(hitRect(index, document, aroundIt, 'contain')).toEqual(['r']);
    const almost = { minX: 293, minY: -1, maxX: 310, maxY: 15 };
    expect(hitRect(index, document, almost, 'contain')).toEqual([]);
  });

  it('selects a line the marquee crosses, but contains it only with both ends', () => {
    const { index, document } = indexed(lineObject('l'));
    const acrossMiddle = { minX: 40, minY: -10, maxX: 60, maxY: 10 };
    expect(hitRect(index, document, acrossMiddle, 'intersect')).toEqual(['l']);
    expect(hitRect(index, document, acrossMiddle, 'contain')).toEqual([]);
    const besideIt = { minX: 40, minY: 3, maxX: 60, maxY: 10 };
    expect(hitRect(index, document, besideIt, 'intersect')).toEqual([]);
    const aroundIt = { minX: -1, minY: -1, maxX: 101, maxY: 1 };
    expect(hitRect(index, document, aroundIt, 'contain')).toEqual(['l']);
  });

  it('selects a connector the marquee crosses, and contains it only with its whole route', () => {
    // Free ends (0, 0) to (50, 50), so its stored value is its placed one.
    const { index, document } = indexed(connectorObject('c'));
    expect(
      hitRect(index, document, { minX: 20, minY: 0, maxX: 30, maxY: 60 }, 'intersect'),
    ).toEqual(['c']);
    expect(hitRect(index, document, { minX: 20, minY: 0, maxX: 30, maxY: 60 }, 'contain')).toEqual(
      [],
    );
    expect(hitRect(index, document, { minX: -5, minY: -5, maxX: 60, maxY: 60 }, 'contain')).toEqual(
      ['c'],
    );
  });

  it('selects a filled path when the marquee lies inside its fill', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const { index, document } = indexed(
      pathObject('filled', square, { isClosed: true, isFilled: true }),
      pathObject('outline', square, { isClosed: true }, { x: 1000 }),
    );
    expect(
      hitRect(index, document, { minX: 40, minY: 40, maxX: 60, maxY: 60 }, 'intersect'),
    ).toEqual(['filled']);
    expect(
      hitRect(index, document, { minX: 1040, minY: 40, maxX: 1060, maxY: 60 }, 'intersect'),
    ).toEqual([]);
  });

  it('contains an image by where it is drawn, fitted in a box off its crop’s aspect', () => {
    // The 4:3 photo left in a 160 × 240 box draws 160 × 120 from y = 60.
    const document = new FakeSceneDocument();
    document.create({ ...imageObject('photo'), width: 160 });
    const index = new SceneSpatialIndex();
    index.apply(document.takeChanges());
    const aroundDrawn = { minX: -1, minY: 59, maxX: 161, maxY: 181 };
    expect(hitRect(index, document, aroundDrawn, 'contain')).toEqual(['photo']);
    const emptyBand = { minX: 0, minY: 0, maxX: 160, maxY: 50 };
    expect(hitRect(index, document, emptyBand, 'intersect')).toEqual([]);
  });

  it('never selects a path with no segments', () => {
    const { index, document } = indexed(pathObject('dot', [{ x: 5, y: 5 }]));
    const around = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(hitRect(index, document, around, 'contain')).toEqual([]);
    expect(hitRect(index, document, around, 'intersect')).toEqual([]);
  });

  it('orders the selection topmost first and skips objects the document no longer has', () => {
    const { index, document } = indexed(
      shapeObject('low', { z: 'a0' }),
      shapeObject('high', { z: 'a1' }),
    );
    const around = { minX: -1, minY: -1, maxX: 11, maxY: 11 };
    expect(hitRect(index, document, around, 'contain')).toEqual(['high', 'low']);
    document.delete('high');
    expect(hitRect(index, document, around, 'contain')).toEqual(['low']);
  });
});

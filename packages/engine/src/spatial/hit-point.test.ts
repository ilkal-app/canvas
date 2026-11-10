import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Shadow } from '@canvas/schema';

import { ConnectorPlacements } from '../connectors/connector-placements.js';
import { evalCubic } from '../paths/bezier.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import {
  connectorObject,
  imageObject,
  lineObject,
  pathObject,
} from './__fixtures__/spatial-objects.js';
import { DEFAULT_HIT_TOLERANCE_PX, hitPoint, hitTopmost } from './hit-point.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { index, document };
}

const AT_ZOOM_1 = { zoom: 1 };

describe('hitPoint', () => {
  it('returns every object under the point, the most deeply nested on top', () => {
    const { index, document } = indexed(...nestedBoard());
    expect(hitPoint(index, document, { x: 60, y: 155 }, AT_ZOOM_1)).toEqual(['g-b', 'f']);
    expect(hitPoint(index, document, { x: 95, y: 115 }, AT_ZOOM_1)).toEqual(['f-a', 'f']);
    expect(hitPoint(index, document, { x: 10, y: 190 }, AT_ZOOM_1)).toEqual(['f']);
    expect(hitPoint(index, document, { x: 10, y: 10 }, AT_ZOOM_1)).toEqual([]);
  });

  it('tests a rotated box exactly, not by its axis-aligned bounds', () => {
    const { index, document } = indexed(...nestedBoard());
    // "r" is a diamond with its top vertex at (300, 0); (295, 1) is inside its bounds only.
    expect(hitPoint(index, document, { x: 295, y: 1 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 300, y: 7 }, AT_ZOOM_1)).toEqual(['r']);
  });

  it('never hits a drop shadow, though the index box takes it in', () => {
    const shadow: Shadow = { x: 40, y: 40, blur: 10, spread: 5, color: [0, 0, 0, 0.5] };
    const { index, document } = indexed(shapeObject('s', { width: 20, height: 20, shadow }));
    expect(index.boundsOf('s' as ObjectId)?.maxX).toBeGreaterThan(60);
    expect(hitPoint(index, document, { x: 50, y: 50 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 10, y: 10 }, AT_ZOOM_1)).toEqual(['s']);
  });

  it('counts a frame’s outline outside its edge as part of it', () => {
    const stroke = { color: [0, 0, 0, 1] as Shadow['color'], width: 6 };
    const outside = indexed(frameObject('f', { stroke, strokeAlign: 'outside' }));
    expect(hitPoint(outside.index, outside.document, { x: -5, y: 50 }, AT_ZOOM_1)).toEqual(['f']);
    expect(hitPoint(outside.index, outside.document, { x: 50, y: 105 }, AT_ZOOM_1)).toEqual(['f']);
    expect(hitPoint(outside.index, outside.document, { x: -8, y: 50 }, AT_ZOOM_1)).toEqual([]);
    const inside = indexed(frameObject('f', { stroke }));
    expect(hitPoint(inside.index, inside.document, { x: -5, y: 50 }, AT_ZOOM_1)).toEqual([]);
  });

  it('orders siblings by z key, higher on top, then by id', () => {
    const { index, document } = indexed(
      shapeObject('low', { z: 'a0' }),
      shapeObject('high', { z: 'a1' }),
      shapeObject('same-b', { z: 'a0' }),
    );
    expect(hitPoint(index, document, { x: 5, y: 5 }, AT_ZOOM_1)).toEqual(['high', 'same-b', 'low']);
  });

  it('orders a child above its parent frame whatever their z keys', () => {
    const { index, document } = indexed(...nestedBoard());
    document.update('f', { z: 'zz' });
    index.apply(document.takeChanges());
    expect(hitPoint(index, document, { x: 95, y: 115 }, AT_ZOOM_1)).toEqual(['f-a', 'f']);
  });

  it('hits a line within half its stroke plus a screen tolerance scaled by the zoom', () => {
    const { index, document } = indexed(lineObject('l', { y: 500 }));
    // The stroke is 2 wide; the default tolerance is 4 px, so 5 world units at zoom 1.
    expect(DEFAULT_HIT_TOLERANCE_PX).toBe(4);
    expect(hitPoint(index, document, { x: 50, y: 504.9 }, AT_ZOOM_1)).toEqual(['l']);
    expect(hitPoint(index, document, { x: 50, y: 505.1 }, AT_ZOOM_1)).toEqual([]);
    // At zoom 0.5 the 4 px tolerance is 8 world units.
    expect(hitPoint(index, document, { x: 50, y: 508.9 }, { zoom: 0.5 })).toEqual(['l']);
    expect(hitPoint(index, document, { x: 50, y: 501 }, { zoom: 8, tolerancePx: 0 })).toEqual([
      'l',
    ]);
    expect(hitPoint(index, document, { x: 50, y: 501.5 }, { zoom: 8, tolerancePx: 0 })).toEqual([]);
  });

  it('hits a line’s heads where they are drawn: a filled triangle inside, an arrow’s barbs', () => {
    const width = 12;
    const { index, document } = indexed(
      lineObject('filled', { stroke: { color: [0, 0, 0, 1], width }, endCap: 'triangle' }),
      lineObject('open', { y: 300, stroke: { color: [0, 0, 0, 1], width }, endCap: 'arrow' }),
    );
    // capLength(12) = 44: the triangle's base spans y = ±22 at x = 56; far from the shaft.
    expect(hitPoint(index, document, { x: 70, y: 14 }, { zoom: 1, tolerancePx: 0 })).toEqual([
      'filled',
    ]);
    // The open arrow's inside is empty; its lower barb runs from (100, 300) to (56, 322).
    expect(hitPoint(index, document, { x: 65, y: 309 }, { zoom: 1, tolerancePx: 0 })).toEqual([]);
    expect(hitPoint(index, document, { x: 78, y: 311 }, { zoom: 1, tolerancePx: 0 })).toEqual([
      'open',
    ]);
  });

  it('hits a line whose ends coincide around its one point, whatever its caps and route', () => {
    const dot = [
      { x: 40, y: 0 },
      { x: 40, y: 0 },
    ] as const;
    const { index, document } = indexed(
      lineObject('dot', { y: 100, points: [...dot], endCap: 'triangle' }),
      lineObject('elbow-dot', { y: 300, points: [...dot], route: 'elbow' }),
    );
    // Half the 2 wide stroke plus the 4 px tolerance: 5 world units from the point.
    expect(hitPoint(index, document, { x: 40, y: 100 }, AT_ZOOM_1)).toEqual(['dot']);
    expect(hitPoint(index, document, { x: 43, y: 104 }, AT_ZOOM_1)).toEqual(['dot']);
    expect(hitPoint(index, document, { x: 44, y: 104 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 40, y: 302 }, AT_ZOOM_1)).toEqual(['elbow-dot']);
  });

  it('hits the inside of a filled closed path, and only the outline of an unfilled one', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 80 },
    ];
    const { index, document } = indexed(
      pathObject('filled', triangle, { isClosed: true, isFilled: true }, { x: 1000 }),
      pathObject('outline', triangle, { isClosed: true }, { x: 2000 }),
    );
    expect(hitPoint(index, document, { x: 1050, y: 30 }, AT_ZOOM_1)).toEqual(['filled']);
    expect(hitPoint(index, document, { x: 2050, y: 30 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 2050, y: 1 }, AT_ZOOM_1)).toEqual(['outline']);
  });

  it('fills only closed loops, as the path pass draws them: not a branching network', () => {
    // A square with one diagonal: every vertex is on a loop but two have three segments.
    const square = pathObject(
      'theta',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      { isClosed: true, isFilled: true },
    );
    const theta = {
      ...square,
      segments: [...square.segments, { ...square.segments[0], id: 'diagonal', b: 'v2' }],
    } as typeof square;
    const { index, document } = indexed(theta);
    expect(hitPoint(index, document, { x: 75, y: 25 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 50, y: 50 }, AT_ZOOM_1)).toEqual(['theta']);
  });

  it('flattens curves for the device pixels and bucket the renderer draws with', () => {
    const arch = pathObject(
      'arch',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      {
        strokeWidth: 0.4,
        handles: [
          { x: 0, y: -80 },
          { x: 0, y: -80 },
        ],
      },
    );
    const { index, document } = indexed(arch);
    // A point on the exact curve where a coarse flattening strays 0.29 from it: more than the
    // stroke's half-width, 0.2; a fine one strays under 0.08.
    const onCurve = evalCubic(
      [
        { x: 0, y: 0 },
        { x: 0, y: -80 },
        { x: 100, y: -80 },
        { x: 100, y: 0 },
      ],
      0.969,
    );
    const exact = { tolerancePx: 0 };
    // At zoom 0.25 and dpr 1 the tolerance is a whole world unit.
    expect(hitPoint(index, document, onCurve, { ...exact, zoom: 0.25 })).toEqual([]);
    // Drawn at dpr 8, the renderer flattens for zoom 2: the pick follows.
    expect(hitPoint(index, document, onCurve, { ...exact, zoom: 0.25, dpr: 8 })).toEqual(['arch']);
    // Between buckets −2 and −1: the zoom's own bucket is −1, fine enough, but a pick that
    // kept −2 by hysteresis, as the renderer would, flattens coarsely.
    const between = { ...exact, zoom: 2 ** -0.65 };
    expect(hitPoint(index, document, onCurve, between)).toEqual(['arch']);
    expect(hitPoint(index, document, onCurve, { ...between, flattenBucket: -2 })).toEqual([]);
  });

  it('follows a curved path segment, not the chord between its ends', () => {
    const curve = pathObject(
      'curve',
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
    const { index, document } = indexed(curve);
    expect(hitPoint(index, document, { x: 50, y: -30 }, AT_ZOOM_1)).toEqual(['curve']);
    expect(hitPoint(index, document, { x: 50, y: 0 }, AT_ZOOM_1)).toEqual([]);
  });

  it('tests paths in their own frame, so rotation and nesting carry over', () => {
    const { index, document } = indexed(
      groupObject('turned', { rotation: Math.PI / 2 }),
      lineObject('l', { parentId: 'turned' }),
    );
    // Rotated 90°, the line runs from (0, 0) down to (0, 100).
    expect(hitPoint(index, document, { x: 0, y: 60 }, AT_ZOOM_1)).toEqual(['l']);
    expect(hitPoint(index, document, { x: 60, y: 0 }, AT_ZOOM_1)).toEqual([]);
  });

  it('picks an image where it is drawn: fitted in a box a merge left off its crop’s aspect', () => {
    // The 4:3 photo left in a 160 × 240 box draws 160 × 120 from y = 60.
    const squeezed = { ...imageObject('photo'), width: 160 };
    const { index, document } = indexed(squeezed);
    expect(hitPoint(index, document, { x: 80, y: 120 }, AT_ZOOM_1)).toEqual(['photo']);
    expect(hitPoint(index, document, { x: 80, y: 30 }, AT_ZOOM_1)).toEqual([]);
    expect(hitPoint(index, document, { x: 80, y: 210 }, AT_ZOOM_1)).toEqual([]);
  });

  it('picks a connector by the route it was placed with, not by its stored ends', () => {
    const a = shapeObject('a', { x: 0, y: 0, width: 100, height: 50 });
    const b = shapeObject('b', { x: 300, y: 200, width: 100, height: 50 });
    const stored = {
      ...connectorObject('c'),
      from: { kind: 'object', objectId: 'a' as ObjectId, anchor: null },
      to: { kind: 'object', objectId: 'b' as ObjectId, anchor: null },
    } as const;
    const document = new FakeSceneDocument();
    document.create(a, b, stored);
    const placements = new ConnectorPlacements();
    const source = {
      get: (id: ObjectId) => {
        const object = document.get(id);
        return object?.type === 'connector'
          ? placements.place(object, {
              get: (target) => document.get(target),
              childrenOf: () => [],
            })
          : object;
      },
    };
    const changes = document.takeChanges();
    const index = new SceneSpatialIndex();
    index.apply({ ...changes, get: source.get });
    // From a's right side (100, 25) to b's left side (300, 225): its middle is (200, 125).
    expect(hitPoint(index, source, { x: 200, y: 125 }, AT_ZOOM_1)).toEqual(['c']);
    expect(hitPoint(index, source, { x: 200, y: 60 }, AT_ZOOM_1)).toEqual([]);
  });

  it('skips candidates the document no longer has', () => {
    const { index } = indexed(shapeObject('gone'));
    expect(hitPoint(index, { get: () => undefined }, { x: 5, y: 5 }, AT_ZOOM_1)).toEqual([]);
  });

  it('rejects a zoom that is not positive and a negative tolerance', () => {
    const { index, document } = indexed(shapeObject('a'));
    expect(() => hitPoint(index, document, { x: 0, y: 0 }, { zoom: 0 })).toThrow(RangeError);
    expect(() => hitPoint(index, document, { x: 0, y: 0 }, { zoom: 1, tolerancePx: -1 })).toThrow(
      RangeError,
    );
  });

  it('works over a plain R-tree of ids too', () => {
    const { document } = indexed(shapeObject('a'));
    const search = { searchRect: () => ['a' as ObjectId] };
    expect(hitPoint(search, document, { x: 5, y: 5 }, AT_ZOOM_1)).toEqual(['a']);
  });
});

describe('hitTopmost', () => {
  it('is the topmost of hitPoint’s hits that the filter accepts', () => {
    const { index, document } = indexed(...nestedBoard());
    const points = [
      { x: 60, y: 155 },
      { x: 95, y: 115 },
      { x: 10, y: 190 },
      { x: 10, y: 10 },
      { x: 300, y: 7 },
    ];
    const filters = [
      () => true,
      (object: BoardObject) => object.type === 'frame',
      (object: BoardObject) => object.type !== 'frame',
    ];
    for (const point of points) {
      for (const accept of filters) {
        const expected = hitPoint(index, document, point, AT_ZOOM_1).find((id) => {
          const object = document.get(id);
          return object !== undefined && accept(object);
        });
        expect(hitTopmost(index, document, point, AT_ZOOM_1, accept)).toBe(expected);
      }
    }
  });

  it('tests exact geometry top down and stops at the first hit', () => {
    // 200 stacked squares under the point: the topmost is hit, so only it is tested exactly.
    const squares = [...Array(200).keys()].map((index) =>
      shapeObject(`s${String(index).padStart(3, '0')}`, {
        width: 20,
        height: 20,
        z: `a${String(index).padStart(3, '0')}`,
      }),
    );
    const { index, document } = indexed(...squares);
    let reads = 0;
    const counting = {
      get: (id: ObjectId) => {
        reads += 1;
        return document.get(id);
      },
    };
    expect(hitTopmost(index, counting, { x: 10, y: 10 }, AT_ZOOM_1)).toBe('s199');
    const topmostReads = reads;
    reads = 0;
    hitPoint(index, counting, { x: 10, y: 10 }, AT_ZOOM_1);
    expect(topmostReads).toBeLessThan(reads);
  });
});

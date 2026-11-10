import { describe, expect, it } from 'vitest';

import {
  buildChildIndex,
  createBoard,
  localBounds,
  OBJECT_TYPES,
  type BoardObject,
  type Rect,
} from '@canvas/schema';

import { frameObject, groupObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import {
  commentObject,
  connectorObject,
  imageObject,
  lineObject,
  pathObject,
  stickyObject,
  textObject,
  videoObject,
} from './__fixtures__/spatial-objects.js';
import { boundsAround } from './bounds.js';
import { connectorGeometry, objectGeometry } from './object-geometry.js';

// One object of every type but group, placed away from the origin so a frame mix-up would show.
const PARITY_FIXTURE: readonly BoardObject[] = [
  shapeObject('shape', { x: 30, y: 40, width: 25, height: 15, rotation: 0.3 }),
  frameObject('frame', { x: -20, y: 5 }),
  {
    ...groupObject('component', { x: -15, y: 25 }),
    type: 'component',
    name: 'Main',
    retired: false,
    width: 80,
    height: 45,
  },
  {
    ...groupObject('instance', { x: 120, y: -30 }),
    type: 'instance',
    mainId: groupObject('component').id,
    overrides: {},
    width: 160,
    height: 90,
  },
  stickyObject('sticky', { x: 7, y: 9 }),
  {
    ...groupObject('link', { x: 60, y: -10, rotation: 0.2 }),
    type: 'link',
    width: 320,
    height: 280,
    url: 'https://example.com/story',
    title: 'Story',
    description: '',
    siteName: '',
    layout: 'vertical',
    status: 'pending',
    unfurlKey: 'k',
  },
  textObject('text'),
  imageObject('image'),
  videoObject('video'),
  lineObject('line', {
    points: [
      { x: 5, y: -3 },
      { x: -40, y: 22 },
    ],
  }),
  lineObject('elbow', {
    route: 'elbow',
    points: [
      { x: 0, y: 10 },
      { x: 60, y: -15 },
    ],
  }),
  pathObject(
    'path',
    [
      { x: 0, y: 0 },
      { x: 80, y: 10 },
      { x: 40, y: 60 },
    ],
    {
      isClosed: true,
      handles: [
        { x: 10, y: -30 },
        { x: -5, y: 25 },
      ],
    },
  ),
  {
    ...groupObject('freehand', { x: 15, y: -40 }),
    type: 'freehand',
    tool: 'marker',
    points: [0, 0, 30, 25, 70, 5, 90, 40],
    pressures: [0.2, 0.6, 1, 0.4],
    stroke: { color: [0.1, 0.1, 0.1, 1], width: 6 },
  },
  connectorObject('connector'),
  commentObject('comment'),
];

// The engine's local hull box, in the schema's Rect form; none for types without geometry.
function engineHull(object: BoardObject): Rect | undefined {
  const geometry = objectGeometry(object);
  if (!geometry) return undefined;
  if (geometry.kind === 'box')
    return { x: 0, y: 0, width: geometry.width, height: geometry.height };
  const bounds = boundsAround(geometry.hullPoints);
  return (
    bounds && {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    }
  );
}

describe('objectGeometry parity with the schema', () => {
  it('covers every object type but group', () => {
    const covered = new Set(PARITY_FIXTURE.map((object) => object.type));
    expect([...covered].sort()).toEqual(OBJECT_TYPES.filter((type) => type !== 'group').sort());
  });

  it("bounds every object exactly as the schema's localBounds does", () => {
    const board = createBoard(PARITY_FIXTURE);
    const children = buildChildIndex(board);
    for (const object of PARITY_FIXTURE) {
      const schemaBounds = localBounds(board, object, children);
      const engineBounds = engineHull(object);
      if (object.type === 'comment') {
        // Its geometry follows another object: the schema gives the empty rectangle at the
        // origin, and the engine indexes nothing.
        expect({ type: object.type, schemaBounds, engineBounds }).toEqual({
          type: object.type,
          schemaBounds: { x: 0, y: 0, width: 0, height: 0 },
          engineBounds: undefined,
        });
      } else if (object.type === 'connector') {
        // Derived when drawn: the schema stores no box; the engine picks and bounds it
        // by the route it was placed with (`connectorGeometry`): here its free ends,
        // (0, 0) to (50, 50), and its arrow's barbs reaching back from (50, 50).
        expect(schemaBounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
        expect(engineBounds).toMatchObject({ x: 0, y: 0 });
        expect(objectGeometry(object)).toEqual(connectorGeometry(object));
      } else {
        expect({ type: object.type, bounds: engineBounds }).toEqual({
          type: object.type,
          bounds: schemaBounds,
        });
      }
    }
  });

  it('has no geometry for a group, whose bounds the schema derives from its children', () => {
    expect(objectGeometry(groupObject('g'))).toBeUndefined();
  });
});

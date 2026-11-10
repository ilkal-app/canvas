import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import { groupObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import type { ConnectorTargetSource } from './connector-placement.js';
import { ConnectorPlacements } from './connector-placements.js';
import { connectorShapeOf } from './connector-shape.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A document of the given objects, with each object's children.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(...objects: BoardObject[]): ConnectorTargetSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (objectId) => byId.get(objectId),
    childrenOf: (parentId) =>
      objects.filter((object) => object.parentId === parentId).map((object) => object.id),
  };
}

/** A straight connector from `a` to `b`, both automatic. */
const LINK: ConnectorObject = {
  ...connectorObject('c'),
  from: { kind: 'object', objectId: id('a'), anchor: null },
  to: { kind: 'object', objectId: id('b'), anchor: null },
};

const A = shapeObject('a', { x: 0, y: 0, width: 100, height: 50 });
const B = shapeObject('b', { x: 300, y: 0, width: 100, height: 50 });

describe('ConnectorPlacements', () => {
  it('places a connector on its targets, as a copy carrying its route', () => {
    const placements = new ConnectorPlacements();
    const placed = placements.place(LINK, sourceOf(A, B, LINK));
    expect(placed).not.toBe(LINK);
    expect(placed).toEqual(LINK);
    expect(connectorShapeOf(placed).path.route).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
    expect(placements.size).toBe(1);
    expect(placements.lastPlaced(id('c'))).toBe(placed);
  });

  it('keeps the placed value while nothing it is placed from changed', () => {
    const placements = new ConnectorPlacements();
    const first = placements.place(LINK, sourceOf(A, B, LINK));
    expect(placements.place(LINK, sourceOf(A, B, LINK))).toBe(first);
  });

  it('keeps the placed value when a target changes without moving the route', () => {
    const placements = new ConnectorPlacements();
    const first = placements.place(LINK, sourceOf(A, B, LINK));
    const recoloured = { ...B, fill: [1, 0, 0, 1] } as BoardObject;
    expect(placements.place(LINK, sourceOf(A, recoloured, LINK))).toBe(first);
  });

  it('places again when a target moves, and on a group target every time', () => {
    const placements = new ConnectorPlacements();
    const first = placements.place(LINK, sourceOf(A, B, LINK));
    const moved = placements.place(LINK, sourceOf(A, { ...B, y: 200 }, LINK));
    expect(moved).not.toBe(first);
    expect(connectorShapeOf(moved).path.route.at(-1)).toEqual({ x: 300, y: 225 });
    const group = groupObject('b');
    const child = shapeObject('child', { x: 300, y: 0, width: 100, height: 50, parentId: 'b' });
    const onGroup = placements.place(LINK, sourceOf(A, group, child, LINK));
    expect(connectorShapeOf(onGroup).path.route.at(-1)).toEqual({ x: 300, y: 25 });
  });

  it('forgets a deleted connector', () => {
    const placements = new ConnectorPlacements();
    placements.place(LINK, sourceOf(A, B, LINK));
    placements.forget(id('c'));
    expect(placements.size).toBe(0);
    expect(placements.lastPlaced(id('c'))).toBeUndefined();
  });
});

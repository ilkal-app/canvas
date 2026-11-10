import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import { frameObject, groupObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { resolveConnectorShape, type ConnectorTargetSource } from './connector-placement.js';

/**
 * A document of objects, with children by parent.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(objects: readonly BoardObject[]): ConnectorTargetSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (id) => byId.get(id),
    childrenOf: (id) => objects.filter((object) => object.parentId === id).map(({ id }) => id),
  };
}

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A straight connector from `a` to `b`, both automatic.
 *
 * @param fields - Fields to override.
 * @returns The connector.
 */
function linking(fields: Partial<ConnectorObject> = {}): ConnectorObject {
  return {
    ...connectorObject('c'),
    from: { kind: 'object', objectId: id('a'), anchor: null },
    to: { kind: 'object', objectId: id('b'), anchor: null },
    ...fields,
  };
}

const A = shapeObject('a', { x: 0, y: 0, width: 100, height: 50 });
const B = shapeObject('b', { x: 300, y: 0, width: 100, height: 50 });

describe('resolveConnectorShape', () => {
  it('runs between the facing sides of two boxes', () => {
    const shape = resolveConnectorShape(linking(), sourceOf([A, B, linking()]));
    expect(shape.path.route).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
    expect(shape.label).toEqual({ x: 200, y: 25 });
  });

  it("works in the connector's own frame", () => {
    const connector = linking({ x: 50, y: 10 });
    const shape = resolveConnectorShape(connector, sourceOf([A, B, connector]));
    expect(shape.path.route).toEqual([
      { x: 50, y: 15 },
      { x: 250, y: 15 },
    ]);
  });

  it('follows a target through its frame', () => {
    const frame = frameObject('f', { x: 0, y: 200, width: 600, height: 400 });
    const inside = { ...B, parentId: frame.id, x: 300, y: 0 };
    const connector = linking();
    const shape = resolveConnectorShape(connector, sourceOf([A, frame, inside, connector]));
    // B is at (300, 200) on the board: the sides facing each other's centres are A's right and
    // B's left.
    expect(shape.path.route).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 225 },
    ]);
  });

  it("measures a group target by its children's bounds", () => {
    const group = groupObject('g', { x: 300, y: 0 });
    const left = shapeObject('l', { parentId: group.id, x: 0, y: 0, width: 40, height: 40 });
    const right = shapeObject('r', { parentId: group.id, x: 60, y: 60, width: 40, height: 40 });
    const connector = linking({ to: { kind: 'object', objectId: group.id, anchor: null } });
    const shape = resolveConnectorShape(connector, sourceOf([A, group, left, right, connector]));
    // The group spans (300, 0) to (400, 100): its left midpoint is (300, 50).
    expect(shape.path.route.at(-1)).toEqual({ x: 300, y: 50 });
  });

  it('measures a group target through nested groups, skipping children it cannot read', () => {
    const outer = groupObject('g', { x: 300, y: 0 });
    const inner = groupObject('h', { parentId: outer.id, x: 0, y: 0 });
    const deep = shapeObject('d', { parentId: inner.id, x: 100, y: 100, width: 50, height: 50 });
    const top = shapeObject('t', { parentId: outer.id, x: 0, y: 0, width: 40, height: 40 });
    const connector = linking({
      to: { kind: 'object', objectId: outer.id, anchor: { x: 1, y: 1 } },
    });
    const objects = [A, outer, inner, deep, top, connector];
    const byId = new Map(objects.map((object) => [object.id, object]));
    const source: ConnectorTargetSource = {
      get: (objectId) => byId.get(objectId),
      // A stale child list: the inner group twice, and a child that is gone.
      childrenOf: (parentId) =>
        parentId === outer.id
          ? [inner.id, top.id, inner.id, id('gone')]
          : objects.filter((object) => object.parentId === parentId).map((object) => object.id),
    };
    const shape = resolveConnectorShape(connector, source);
    // The group spans (300, 0) to (450, 150): its bottom-right corner.
    expect(shape.path.route.at(-1)).toEqual({ x: 450, y: 150 });
  });

  it('places an end on a target the document does not hold at the origin', () => {
    const connector = linking();
    const shape = resolveConnectorShape(connector, sourceOf([B, connector]));
    expect(shape.path.route[0]).toEqual({ x: 0, y: 0 });
    // B measures from the origin: its left midpoint.
    expect(shape.path.route[1]).toEqual({ x: 300, y: 25 });
  });

  it('keeps free ends where they are stored', () => {
    const connector = linking({
      from: { kind: 'point', x: -10, y: -20 },
      to: { kind: 'object', objectId: id('b'), anchor: { x: 1, y: 1 } },
      route: 'curved',
    });
    const shape = resolveConnectorShape(connector, sourceOf([B, connector]));
    expect(shape.path.curve?.[0]).toEqual({ x: -10, y: -20 });
    expect(shape.path.curve?.[3]).toEqual({ x: 400, y: 50 });
  });
});

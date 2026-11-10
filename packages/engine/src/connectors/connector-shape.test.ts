import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import type { ConnectorPath } from './connector-path.js';
import {
  connectorShapeFrom,
  connectorShapeOf,
  isSameConnectorPath,
  isSameConnectorShape,
  placedConnector,
} from './connector-shape.js';

const straight = (x: number): ConnectorPath => ({
  route: [
    { x: 0, y: 0 },
    { x, y: 0 },
  ],
  curve: undefined,
});

describe('connectorShapeOf', () => {
  it('draws a value that did not come through the router from its free ends, attached ends at its origin', () => {
    const connector: ConnectorObject = {
      ...connectorObject('c'),
      from: { kind: 'point', x: 30, y: 40 },
      to: { kind: 'object', objectId: 'gone' as ObjectId, anchor: null },
    };
    const shape = connectorShapeOf(connector);
    expect(shape.path.route).toEqual([
      { x: 30, y: 40 },
      { x: 0, y: 0 },
    ]);
    expect(connectorShapeOf(connector)).toBe(shape);
  });

  it('draws a placed value with the shape it was placed with', () => {
    const connector = connectorObject('c');
    const shape = connectorShapeFrom(
      connector,
      { point: { x: 1, y: 2 }, normal: null },
      { point: { x: 9, y: 2 }, normal: null },
    );
    const placed = placedConnector(connector, shape);
    expect(placed).not.toBe(connector);
    expect(placed).toEqual(connector);
    expect(connectorShapeOf(placed)).toBe(shape);
  });
});

describe('isSameConnectorPath', () => {
  it('compares the points, then the curve', () => {
    expect(isSameConnectorPath(straight(10), straight(10))).toBe(true);
    expect(isSameConnectorPath(straight(10), straight(11))).toBe(false);
    expect(isSameConnectorPath(straight(10), { route: [{ x: 0, y: 0 }], curve: undefined })).toBe(
      false,
    );
    const curve = [
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 0 },
    ] as const;
    const curved = { ...straight(10), curve };
    expect(isSameConnectorPath(curved, straight(10))).toBe(false);
    expect(isSameConnectorPath(curved, { ...straight(10), curve: [...curve] })).toBe(true);
    const bent = {
      ...straight(10),
      curve: [curve[0], { x: 0, y: 6 }, curve[2], curve[3]] as const,
    };
    expect(isSameConnectorPath(curved, bent)).toBe(false);
  });

  it('tells shapes apart by their label point too', () => {
    const path = straight(10);
    expect(
      isSameConnectorShape({ path, label: { x: 5, y: 0 } }, { path, label: { x: 5, y: 0 } }),
    ).toBe(true);
    expect(
      isSameConnectorShape({ path, label: { x: 5, y: 0 } }, { path, label: { x: 4, y: 0 } }),
    ).toBe(false);
  });
});

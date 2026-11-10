import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import {
  frameObject,
  groupObject,
  shapeObject,
  sourceOf,
} from '../scene/__fixtures__/scene-objects.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { connectorPlacementKey, isSamePlacementKey } from './connector-placement-key.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A connector from `a` to `b`.
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

describe('connectorPlacementKey', () => {
  const frame = frameObject('f');
  const a = shapeObject('a', { parentId: frame.id });
  const b = shapeObject('b', { parentId: frame.id, x: 300 });

  it('holds the connector and its targets, not the frame they share', () => {
    const connector = linking({ parentId: frame.id });
    const key = connectorPlacementKey(connector, sourceOf([frame, a, b, connector]));
    expect(key).toEqual([connector, a, connector, b]);
    const moved = { ...frame, x: 500 };
    const after = connectorPlacementKey(connector, sourceOf([moved, a, b, connector]));
    expect(isSamePlacementKey(key, after)).toBe(true);
  });

  it('holds the frames below what the ends share', () => {
    const other = frameObject('g');
    const outside = { ...b, parentId: other.id };
    const connector = linking({ parentId: frame.id });
    const key = connectorPlacementKey(connector, sourceOf([frame, other, a, outside, connector]));
    expect(key).toContain(frame);
    expect(key).toContain(other);
    const moved = { ...other, y: 90 };
    const after = connectorPlacementKey(connector, sourceOf([frame, moved, a, outside, connector]));
    expect(isSamePlacementKey(key, after)).toBe(false);
  });

  it('has none for a group target or a missing one, so the connector is always placed', () => {
    const group = groupObject('b');
    const connector = linking();
    const objects: BoardObject[] = [a, group, connector];
    expect(connectorPlacementKey(connector, sourceOf(objects))).toBeUndefined();
    expect(connectorPlacementKey(connector, sourceOf([connector]))).toBeUndefined();
    expect(isSamePlacementKey(undefined, undefined)).toBe(false);
  });

  it('ends a chain at a parent cycle', () => {
    const loopA = { ...groupObject('loop-a'), parentId: id('loop-b') };
    const loopB = { ...groupObject('loop-b'), parentId: id('loop-a') };
    const inLoop = { ...a, parentId: loopA.id };
    const connector = linking({ to: { kind: 'point', x: 0, y: 0 } });
    expect(connectorPlacementKey(connector, sourceOf([loopA, loopB, inLoop, connector]))).toEqual([
      connector,
      inLoop,
      loopA,
      loopB,
    ]);
  });

  it('is the connector alone when both ends are free', () => {
    const connector = linking({
      from: { kind: 'point', x: 0, y: 0 },
      to: { kind: 'point', x: 1, y: 1 },
    });
    expect(connectorPlacementKey(connector, sourceOf([connector]))).toEqual([connector]);
  });
});

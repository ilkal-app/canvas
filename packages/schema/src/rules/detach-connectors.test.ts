import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { ConnectorObject } from '../objects/connector-object.js';

import { deepFreeze } from './__fixtures__/deep-freeze.js';
import { detachConnectorsFrom } from './detach-connectors.js';

const id = (value: string): ObjectId => value as ObjectId;

function connectorOf(board: ReturnType<typeof createBoard>, connectorId: string): ConnectorObject {
  const connector = board.objects.get(id(connectorId));
  if (connector?.type !== 'connector') throw new Error(`no connector ${connectorId}`);
  return connector;
}

describe('detachConnectorsFrom', () => {
  const box = sampleObject('shape', 'box', { x: 100, y: 100, width: 40, height: 20 });
  const keep = sampleObject('shape', 'keep', { x: 0, y: 0 });

  it('turns an end attached to a deleted object into a free point where the anchor was', () => {
    const connector = sampleObject('connector', 'c', {
      x: 10,
      y: 10,
      from: { kind: 'object', objectId: box.id, anchor: { x: 1, y: 0.5 } },
      to: { kind: 'object', objectId: keep.id, anchor: null },
    });
    const board = deepFreeze(createBoard([box, keep, connector]));
    const next = detachConnectorsFrom(board, [box.id]);
    // The anchor is (140, 110) on the board, which is (130, 100) from the connector's origin.
    expect(connectorOf(next, 'c').from).toEqual({ kind: 'point', x: 130, y: 100 });
    expect(connectorOf(next, 'c').to).toEqual(connector.to);
  });

  it('stores a detached end as computed when the object it was on is past the bound', () => {
    const far = sampleObject('shape', 'far', { x: 1e308, y: 0, width: 40, height: 20 });
    const connector = sampleObject('connector', 'c', {
      x: 0,
      y: 0,
      from: { kind: 'object', objectId: far.id, anchor: { x: 0, y: 0 } },
      to: { kind: 'point', x: 1, y: 1 },
    });
    const next = detachConnectorsFrom(createBoard([far, connector]), [far.id]);
    expect(connectorOf(next, 'c').from).toEqual({ kind: 'point', x: 1e308, y: 0 });
  });

  it('places an automatic anchor on the target side nearest the other end, where it was drawn', () => {
    const connector = sampleObject('connector', 'c', {
      x: 0,
      y: 0,
      from: { kind: 'object', objectId: box.id, anchor: null },
    });
    const next = detachConnectorsFrom(createBoard([box, connector]), [box.id]);
    // The other end is the free point (50, 50): the box's left midpoint is the nearest.
    expect(connectorOf(next, 'c').from).toEqual({ kind: 'point', x: 100, y: 110 });
  });

  it('accounts for a rotated target inside a frame and a connector inside a rotated group', () => {
    const frame = sampleObject('frame', 'f', { x: 1000, y: 0 });
    const target = sampleObject('shape', 't', {
      parentId: frame.id,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: Math.PI / 2,
    });
    const group = sampleObject('group', 'g', { x: 0, y: 0, rotation: Math.PI });
    const connector = sampleObject('connector', 'c', {
      parentId: group.id,
      x: 0,
      y: 0,
      from: { kind: 'object', objectId: target.id, anchor: { x: 1, y: 0 } },
    });
    const next = detachConnectorsFrom(createBoard([frame, target, group, connector]), [target.id]);
    // The anchor (10, 0) in the target turns to (0, 10), sits at (1000, 10) on the board, and at
    // (-1000, -10) in the half-turned group, which is the connector's frame.
    const end = connectorOf(next, 'c').from;
    expect(end.kind).toBe('point');
    if (end.kind !== 'point') return;
    expect(end.x).toBeCloseTo(-1000, 9);
    expect(end.y).toBeCloseTo(-10, 9);
  });

  it('leaves the board unchanged, sharing every object, when no end points at the deleted ids', () => {
    const connector = sampleObject('connector', 'c', {
      from: { kind: 'object', objectId: keep.id, anchor: null },
    });
    const board = createBoard([box, keep, connector]);
    const next = detachConnectorsFrom(board, [box.id]);
    expect(next.objects.get(connector.id)).toBe(connector);
    expect(next.objects.get(box.id)).toBe(box);
  });

  it('does not detach a connector that is itself being deleted', () => {
    const connector = sampleObject('connector', 'c', {
      from: { kind: 'object', objectId: box.id, anchor: null },
    });
    const next = detachConnectorsFrom(createBoard([box, connector]), [box.id, connector.id]);
    expect(next.objects.get(connector.id)).toBe(connector);
  });

  it('frees an end whose target is already missing at the connector origin', () => {
    const connector = sampleObject('connector', 'c', {
      from: { kind: 'object', objectId: id('gone'), anchor: null },
    });
    const next = detachConnectorsFrom(createBoard([connector]), [id('gone')]);
    expect(connectorOf(next, 'c').from).toEqual({ kind: 'point', x: 0, y: 0 });
  });

  it('never mutates its input board', () => {
    const connector = sampleObject('connector', 'c', {
      from: { kind: 'object', objectId: box.id, anchor: null },
    });
    const board = deepFreeze(createBoard([box, connector]));
    const before = new Map(board.objects);
    detachConnectorsFrom(board, [box.id]);
    expect(board.objects).toEqual(before);
    expect(board.objects.get(connector.id)).toBe(connector);
  });
});

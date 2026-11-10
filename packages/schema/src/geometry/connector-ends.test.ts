import { describe, expect, it } from 'vitest';

import { placeConnectorEnds, type ConnectorEndInput } from './connector-ends.js';
import { IDENTITY_TRANSFORM, placementTransform } from './rigid-transform.js';

/**
 * An automatic end on a 100 × 50 box placed at (x, y), turned by `rotation`.
 *
 * @param x - Where the box's origin is.
 * @param y - Likewise down.
 * @param rotation - Its turn, radians.
 * @returns The end.
 */
function boxAt(x: number, y: number, rotation = 0): ConnectorEndInput {
  return {
    kind: 'object',
    anchor: null,
    box: {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      toConnector: placementTransform(x, y, rotation),
    },
  };
}

const point = (x: number, y: number): ConnectorEndInput => ({ kind: 'point', point: { x, y } });

/**
 * Rounds a placed end's numbers so turned boxes compare exactly.
 *
 * @param value - A number.
 * @returns It rounded to 1e-9.
 */
const round = (value: number): number => Math.round(value * 1e9) / 1e9 + 0;

describe('placeConnectorEnds', () => {
  it('keeps free points where they are, with no normal', () => {
    const placed = placeConnectorEnds(point(1, 2), point(3, 4));
    expect(placed.from).toEqual({ point: { x: 1, y: 2 }, normal: null });
    expect(placed.to).toEqual({ point: { x: 3, y: 4 }, normal: null });
  });

  it('puts an automatic anchor on the side nearest a free point', () => {
    const placed = placeConnectorEnds(boxAt(0, 0), point(400, 25));
    expect(placed.from).toEqual({ point: { x: 100, y: 25 }, normal: { x: 1, y: 0 } });
    const below = placeConnectorEnds(boxAt(0, 0), point(50, 300));
    expect(below.from).toEqual({ point: { x: 50, y: 50 }, normal: { x: 0, y: 1 } });
  });

  it('measures two automatic anchors from each other centre', () => {
    const placed = placeConnectorEnds(boxAt(0, 0), boxAt(300, 0));
    expect(placed.from.point).toEqual({ x: 100, y: 25 });
    expect(placed.to).toEqual({ point: { x: 300, y: 25 }, normal: { x: -1, y: 0 } });
  });

  it('puts a fixed anchor at its fraction and leaves along its nearest side', () => {
    const target = boxAt(10, 20);
    if (target.kind !== 'object') throw new Error('unreachable');
    const placed = placeConnectorEnds({ ...target, anchor: { x: 0.25, y: 0 } }, point(0, 500));
    expect(placed.from).toEqual({ point: { x: 35, y: 20 }, normal: { x: 0, y: -1 } });
    const left = placeConnectorEnds({ ...target, anchor: { x: 0, y: 0.6 } }, point(0, 0));
    expect(left.from).toEqual({ point: { x: 10, y: 50 }, normal: { x: -1, y: 0 } });
  });

  it('breaks ties top, right, bottom, left', () => {
    const box = { bounds: { x: 0, y: 0, width: 10, height: 10 }, toConnector: IDENTITY_TRANSFORM };
    const square: ConnectorEndInput = { kind: 'object', anchor: null, box };
    // Equally near the top and the right midpoints.
    expect(placeConnectorEnds(square, point(10, 0)).from.normal).toEqual({ x: 0, y: -1 });
    const centred = placeConnectorEnds(
      { kind: 'object', anchor: { x: 0.5, y: 0.5 }, box },
      point(0, 0),
    );
    expect(centred.from.normal).toEqual({ x: 0, y: -1 });
  });

  it('turns the side and its normal with the target', () => {
    const placed = placeConnectorEnds(boxAt(0, 0, Math.PI / 2), point(-300, 50));
    // Turned a quarter clockwise, the box's bottom side faces −x.
    expect(placed.from.point.x).toBeCloseTo(-50, 9);
    expect(placed.from.point.y).toBeCloseTo(50, 9);
    expect(placed.from.normal && round(placed.from.normal.x)).toBe(-1);
    expect(placed.from.normal && round(placed.from.normal.y)).toBe(0);
  });

  it('puts an end on a missing target at the origin', () => {
    const missing: ConnectorEndInput = { kind: 'object', anchor: null, box: undefined };
    const placed = placeConnectorEnds(missing, boxAt(300, 0));
    expect(placed.from).toEqual({ point: { x: 0, y: 0 }, normal: null });
    // The other end measures from the origin: its left side is nearest.
    expect(placed.to.point).toEqual({ x: 300, y: 25 });
  });
});

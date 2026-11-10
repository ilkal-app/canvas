import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  composeTransforms,
  IDENTITY_TRANSFORM,
  invertTransform,
  placementTransform,
} from './rigid-transform.js';

function expectPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('rigid transforms', () => {
  it('place a local point by rotating about the origin, clockwise on a y-down screen, then translating', () => {
    const transform = placementTransform(100, 50, Math.PI / 2);
    // +x in the object's frame points down the screen after a quarter turn clockwise.
    expectPointClose(applyTransform(transform, { x: 10, y: 0 }), { x: 100, y: 60 });
    expectPointClose(applyTransform(transform, { x: 0, y: 10 }), { x: 90, y: 50 });
  });

  it('compose outer after inner, as a child placed inside a rotated parent', () => {
    const parent = placementTransform(100, 0, Math.PI / 2);
    const child = placementTransform(10, 0, 0);
    expectPointClose(applyTransform(composeTransforms(parent, child), { x: 0, y: 0 }), {
      x: 100,
      y: 10,
    });
  });

  it('invert to map board points back into the local frame', () => {
    const transform = composeTransforms(
      placementTransform(3, -7, 0.4),
      placementTransform(-20, 11, 2.1),
    );
    const point = { x: 12.5, y: -3 };
    expectPointClose(
      applyTransform(invertTransform(transform), applyTransform(transform, point)),
      point,
    );
  });

  it('leave points unchanged under the identity', () => {
    expect(applyTransform(IDENTITY_TRANSFORM, { x: 4, y: 5 })).toEqual({ x: 4, y: 5 });
  });
});

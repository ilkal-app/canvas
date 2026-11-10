import { describe, expect, it } from 'vitest';

import { connectorLabelPoint } from './connector-label.js';

describe('connectorLabelPoint', () => {
  it('is the middle of a straight route', () => {
    const point = connectorLabelPoint({
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
      curve: undefined,
    });
    expect(point).toEqual({ x: 50, y: 20 });
  });

  it('is halfway along an elbow by length, on whichever piece that falls', () => {
    // Pieces of 100, 20 and 20: halfway (70) is on the first.
    const point = connectorLabelPoint({
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
        { x: 120, y: 20 },
      ],
      curve: undefined,
    });
    expect(point).toEqual({ x: 70, y: 0 });
  });

  it('is on a symmetric curve at its middle', () => {
    const point = connectorLabelPoint({
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      curve: [
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 100, y: 40 },
        { x: 100, y: 0 },
      ],
    });
    expect(point.x).toBeCloseTo(50, 6);
    // The cubic's middle is at 3/4 of its handles' height.
    expect(point.y).toBeCloseTo(30, 0);
  });

  it('is the origin of a route with no points', () => {
    expect(connectorLabelPoint({ route: [], curve: undefined })).toEqual({ x: 0, y: 0 });
  });

  it('is the point of a route with no length', () => {
    expect(connectorLabelPoint({ route: [{ x: 3, y: 4 }], curve: undefined })).toEqual({
      x: 3,
      y: 4,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { connectorLabelPoint, connectorPolylineOf } from './connector-label.js';
import type { ConnectorPath } from './connector-path.js';

/**
 * Independently measures a fraction along the polyline used to draw the route.
 *
 * @param points - The flattened route.
 * @param position - The requested length fraction.
 * @returns The interpolated point.
 */
function pointAt(points: readonly { x: number; y: number }[], position: number) {
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index] ?? point;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * position;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const from = points[index] ?? { x: 0, y: 0 };
    const to = points[index + 1] ?? from;
    if (length > 0 && remaining <= length) {
      return {
        x: from.x + ((to.x - from.x) * remaining) / length,
        y: from.y + ((to.y - from.y) * remaining) / length,
      };
    }
    remaining -= length;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

describe('connectorLabelPoint route fraction', () => {
  const labelPoint: (path: ConnectorPath, position?: number) => { x: number; y: number } =
    connectorLabelPoint;
  it('uses the midpoint by default and endpoints at zero and one on a straight route', () => {
    const path: ConnectorPath = {
      route: [
        { x: 10, y: 20 },
        { x: 210, y: 20 },
      ],
      curve: undefined,
    };
    expect(labelPoint(path)).toEqual({ x: 110, y: 20 });
    expect(labelPoint(path, 0)).toEqual({ x: 10, y: 20 });
    expect(labelPoint(path, 0.25)).toEqual({ x: 60, y: 20 });
    expect(labelPoint(path, 1)).toEqual({ x: 210, y: 20 });
  });

  it('measures an elbow by arc length, including the bend', () => {
    const path: ConnectorPath = {
      route: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
      ],
      curve: undefined,
    };
    expect(labelPoint(path, 0.25)).toEqual({ x: 40, y: 0 });
    expect(labelPoint(path, 0.75)).toEqual({ x: 100, y: 20 });
    expect(labelPoint(path)).toEqual({ x: 80, y: 0 });
  });

  it('uses the curved route’s flattened polyline', () => {
    const path: ConnectorPath = {
      route: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
      curve: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 120, y: 100 },
        { x: 120, y: 0 },
      ],
    };
    const polyline = connectorPolylineOf(path);
    expect(polyline.length).toBeGreaterThan(2);
    for (const position of [0, 0.25, 0.5, 0.75, 1]) {
      const actual = labelPoint(path, position);
      const expected = pointAt(polyline, position);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
    }
    expect(labelPoint(path)).toEqual(labelPoint(path, 0.5));
  });
});

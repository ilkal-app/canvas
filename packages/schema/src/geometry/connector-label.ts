import type { Point } from '../fields/point.js';

import { flattenCubic } from './bezier.js';
import type { ConnectorPath } from './connector-path.js';
import { flattenToleranceOf } from './flatten-bucket.js';

/** The tolerance a curve is measured at for its label, world units (zoom 1's). */
const LABEL_TOLERANCE = flattenToleranceOf(0);

/**
 * The centre line a path draws: its polyline, or its curve flattened at zoom 1's tolerance.
 *
 * @param path - The path.
 * @returns The polyline.
 */
export function connectorPolylineOf(path: ConnectorPath): readonly Point[] {
  return path.curve ? flattenCubic(path.curve, LABEL_TOLERANCE) : path.route;
}

/**
 * Where a connector's label is centred: the point at `position` of the way
 * along its centre line by length, so it sits on the route whatever its bends; halfway when no
 * position is given (a connector without `labelPosition`); the last point of a route
 * with no length (its only place). Pure.
 *
 * @param path - The connector's path.
 * @param position - The fraction of the length, 0 (the start) to 1 (the end); 0.5 if absent.
 * @returns The point, in the connector's frame.
 */
export function connectorLabelPoint(path: ConnectorPath, position = 0.5): Point {
  const [first = { x: 0, y: 0 }, ...rest] = connectorPolylineOf(path);
  const pieces: { readonly from: Point; readonly to: Point; readonly length: number }[] = [];
  let from = first;
  for (const to of rest) {
    pieces.push({ from, to, length: Math.hypot(to.x - from.x, to.y - from.y) });
    from = to;
  }
  let remaining = pieces.reduce((sum, { length }) => sum + length, 0) * position;
  for (const piece of pieces) {
    if (piece.length > 0 && remaining <= piece.length) {
      const t = remaining / piece.length;
      return {
        x: piece.from.x + (piece.to.x - piece.from.x) * t,
        y: piece.from.y + (piece.to.y - piece.from.y) * t,
      };
    }
    remaining -= piece.length;
  }
  // Rounding can carry the end (1) just past the last piece: that is the route's last point.
  return { x: from.x, y: from.y };
}

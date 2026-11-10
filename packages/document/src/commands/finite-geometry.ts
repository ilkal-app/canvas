import { finiteCoordinate, type ConnectorEnd, type Point } from '@canvas/schema';

import type { ObjectPatch } from '../store/document-store.js';

/**
 * A point with every coordinate finite.
 *
 * @param point - The point.
 * @returns The point, unchanged when it is finite.
 */
function finitePoint<Shape extends Point>(point: Shape): Shape {
  return { ...point, x: finiteCoordinate(point.x), y: finiteCoordinate(point.y) };
}

/**
 * A connector end with a free point's coordinates finite.
 *
 * @param end - The end.
 * @returns The end, unchanged when it is finite or attached.
 */
function finiteEnd(end: ConnectorEnd): ConnectorEnd {
  return end.kind === 'point' ? finitePoint(end) : end;
}

/**
 * Makes the geometry of a patch that a command computed from stored data storable: every value
 * that is finite is kept as it is, past the board's bound too, and only what is not finite (a
 * group scaled by a factor that overflows, over descendants stored far away) is clamped
 * (`finiteCoordinate`; a size is not made negative). A value derived from stored data is
 * stored as computed, never a reason to refuse an honest command.
 *
 * @param patch - The patch a group resize computed for one object.
 * @returns The patch with every coordinate and size finite.
 */
export function finiteGeometry(patch: ObjectPatch): ObjectPatch {
  const result: Record<string, unknown> = { ...patch };
  if (typeof patch.x === 'number') result.x = finiteCoordinate(patch.x);
  if (typeof patch.y === 'number') result.y = finiteCoordinate(patch.y);
  for (const key of ['width', 'height'] as const) {
    const value = patch[key as keyof ObjectPatch];
    if (typeof value === 'number') result[key] = Math.max(0, finiteCoordinate(value));
  }
  if ('points' in patch && Array.isArray(patch.points)) {
    // A line's two points, or a freehand stroke's flat x, y pairs.
    result.points = (patch.points as readonly (Point | number)[]).map((point) =>
      typeof point === 'number' ? finiteCoordinate(point) : finitePoint(point),
    );
  }
  if ('vertices' in patch && Array.isArray(patch.vertices)) {
    result.vertices = patch.vertices.map((vertex) => finitePoint(vertex));
  }
  if ('segments' in patch && Array.isArray(patch.segments)) {
    result.segments = patch.segments.map((segment) => ({
      ...segment,
      ha: finitePoint(segment.ha),
      hb: finitePoint(segment.hb),
    }));
  }
  if ('from' in patch) result.from = finiteEnd(patch.from);
  if ('to' in patch) result.to = finiteEnd(patch.to);
  return result;
}

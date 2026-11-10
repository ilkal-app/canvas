import type { DrawnPath } from './drawn-path.js';

/**
 * How much of the path pass's per-frame mesh budget an object's mesh takes, in segments: a
 * path's segments, a freehand stroke's stored points, and one for a line or connector,
 * a handful of pieces at most.
 *
 * @param object - The drawn object.
 * @returns At least 1.
 */
export function meshSegmentsOf(object: DrawnPath): number {
  if (object.type === 'path') return Math.max(1, object.segments.length);
  if (object.type === 'freehand') return Math.max(1, Math.floor(object.points.length / 2));
  return 1;
}

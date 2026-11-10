import type { WorldBounds } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import { snapBox, type SnapGrid } from './snap-box.js';
import type { SnapGuide } from './snap-guide.js';

/** A snapped point and the guides through it. */
export interface SnappedPoint {
  /** The point, moved onto the lines it snapped to, world units. */
  readonly point: Point;
  /** A guide through each candidate line the point lies on, from the point across the candidates. */
  readonly guides: readonly SnapGuide[];
}

/** A point's only line on each axis. */
const POINT_EDGES = { x: ['min'], y: ['min'] } as const;

/**
 * Snaps a point, such as the corner of a creation drag: on each axis,
 * onto the nearest edge or centre of a candidate within the threshold, else onto the grid line
 * within it, if there is a grid. The rules of `snapBox`, for a box of no size. Pure.
 *
 * @param point - The point, world units.
 * @param candidates - Nearby objects' boxes, world units.
 * @param thresholdWorld - How near a line must be to snap, world units.
 * @param grid - The grid, when snapping to it; none if absent.
 * @returns The snapped point and its guides.
 */
export function snapPoint(
  point: Point,
  candidates: readonly WorldBounds[],
  thresholdWorld: number,
  grid?: SnapGrid,
): SnappedPoint {
  const box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  const { delta, guides } = snapBox(box, candidates, thresholdWorld, grid, POINT_EDGES);
  return { point: { x: point.x + delta.x, y: point.y + delta.y }, guides };
}

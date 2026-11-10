import { gridSpacingAt, type WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { SelectionSource } from '../select/selection-geometry.js';

import { snapCandidatesNear, type SnapIndex } from './snap-candidates.js';
import { snapPoint, type SnappedPoint } from './snap-point.js';
import { snapThresholdAt } from './snap-threshold.js';

/** Where a point finds the objects it may snap to: a spatial index and its document. */
export interface PointSnapSource {
  /** The spatial index candidates come from (the select tool's). */
  readonly index: SnapIndex;
  /** The document the index's objects are read from. */
  readonly source: SelectionSource;
}

/** One point to snap, as a tool drawing with the pointer asks. */
export interface PointSnapQuery {
  /** The camera zoom, CSS px per world unit: the threshold and the grid follow it. */
  readonly zoom: number;
  /** What is on screen, world units; candidates are looked for everywhere if absent. */
  readonly viewport: WorldBounds | undefined;
  /** Whether the grid shows, so a point with no object near snaps to it. */
  readonly isGridVisible: boolean;
  /** Objects left out of the candidates (what is being drawn). */
  readonly excludedIds: ReadonlySet<ObjectId>;
}

/** The whole board, for a query with no viewport. */
const EVERYWHERE: WorldBounds = {
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

/**
 * Snaps a point a tool draws with (as `snapPoint` does): onto the nearest edge or centre of an
 * object on screen within 6 CSS px on each axis (`snapThresholdAt`), else onto the grid while it
 * shows. The pen's points and a shape's creation corners snap through it. Pure: reads the index and
 * the document.
 *
 * @param point - The point, world units.
 * @param snap - Where candidates come from; the grid only when absent.
 * @param query - The zoom, the viewport, the grid and the objects left out.
 * @returns The snapped point and the guides to show.
 */
export function snapWorldPoint(
  point: Point,
  snap: PointSnapSource | undefined,
  query: PointSnapQuery,
): SnappedPoint {
  const thresholdWorld = snapThresholdAt(query.zoom);
  const box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  const near = { viewport: query.viewport ?? EVERYWHERE, thresholdWorld };
  const candidates =
    snap === undefined
      ? []
      : snapCandidatesNear(snap.index, snap.source, box, query.excludedIds, near);
  const grid = query.isGridVisible ? { spacing: gridSpacingAt(query.zoom) } : undefined;
  return snapPoint(point, candidates, thresholdWorld, grid);
}

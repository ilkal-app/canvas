import type { WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { SnapSettings } from '../select/drag-snap.js';
import type { SelectionSource } from '../select/selection-geometry.js';
import type { SnapIndex } from '../snap/snap-candidates.js';
import type { SnappedPoint } from '../snap/snap-point.js';
import { snapWorldPoint } from '../snap/snap-world-point.js';

/** Where a creation drag finds what to snap to (a `PointSnapSource` of the snap area). */
export interface CreationSnapSource {
  /** The spatial index candidates come from (the select tool's). */
  readonly index: SnapIndex;
  /** The document the index's objects are read from. */
  readonly source: SelectionSource;
}

/** One pointer step of a creation drag, as it snaps. */
export interface CreationSnapRequest {
  /** The person's preferences. */
  readonly settings: SnapSettings;
  /** Where the candidates come from; the grid only when absent. */
  readonly snap: CreationSnapSource | undefined;
  /** The camera zoom, CSS px per world unit: the threshold and the grid follow it. */
  readonly zoom: number;
  /** What is on screen, world units; candidates are looked for everywhere if absent. */
  readonly viewport: WorldBounds | undefined;
}

/** Nothing is being moved by a creation drag, so no object is left out of the candidates. */
const NO_EXCLUDED: ReadonlySet<ObjectId> = new Set();

/**
 * Snaps a corner of a creation drag: onto the edges
 * and centres of the objects on screen within 6 CSS px, else onto the grid while it shows
 * (`snapWorldPoint`); nothing while snapping is off. Pure: reads the index and the document.
 *
 * @param point - The corner, world units.
 * @param request - The preferences, the index, the zoom and the viewport.
 * @returns The snapped corner and the guides to show.
 */
export function snapCreationPoint(point: Point, request: CreationSnapRequest): SnappedPoint {
  const { settings, snap, zoom, viewport } = request;
  if (!settings.isEnabled) return { point, guides: [] };
  return snapWorldPoint(point, snap, {
    zoom,
    viewport,
    isGridVisible: settings.isGridVisible,
    excludedIds: NO_EXCLUDED,
  });
}

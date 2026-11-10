import type { Point } from '@canvas/schema';

import type { SelectionSource } from '../select/selection-geometry.js';
import type { SnapIndex } from '../snap/snap-candidates.js';
import type { SnappedPoint } from '../snap/snap-point.js';
import { snapWorldPoint } from '../snap/snap-world-point.js';

import type { PenSnapRequest } from './pen-context.js';

/**
 * The pen's point snapping over a document's spatial index (as `snapPoint` does): a point snaps to
 * the nearest edge or centre of an object on screen within 6 CSS px on each axis, else to the grid
 * when it shows, as the select tool's drags snap (`snapWorldPoint`). The path being drawn is left
 * out. Pure: reads the index and the document.
 *
 * @param index - The spatial index candidates come from.
 * @param source - The document.
 * @returns The snapper the pen's context takes (`PenModeContext.snapPoint`).
 */
export function createPenSnapper(
  index: SnapIndex,
  source: SelectionSource,
): (world: Point, request: PenSnapRequest) => SnappedPoint {
  return (world, request) =>
    snapWorldPoint(
      world,
      { index, source },
      {
        zoom: request.zoom,
        viewport: request.viewport,
        isGridVisible: request.settings.isGridVisible,
        excludedIds: request.excludedIds,
      },
    );
}

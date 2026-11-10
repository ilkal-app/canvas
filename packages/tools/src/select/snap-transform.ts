import { gridSpacingAt, type WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { snapCandidatesNear, type SnapIndex } from '../snap/snap-candidates.js';
import { snapThresholdAt } from '../snap/snap-threshold.js';

import {
  snapMove,
  type DragSnapContext,
  type SnappedDrag,
  type SnapSettings,
  type TransformIntent,
} from './drag-snap.js';
import type { OrientedBox } from './oriented-box.js';
import { snapResize } from './resize-snap.js';
import type { SelectionSource } from './selection-geometry.js';

/** Everything one pointer step of a drag snaps with. */
export interface DragSnapRequest {
  /** The person's preferences. */
  readonly settings: SnapSettings;
  /** Whether the snap modifier is held (Alt, Option on a Mac): nothing snaps. */
  readonly isSuspended: boolean;
  /** The spatial index candidates come from; without one, drags snap to the grid only. */
  readonly index: SnapIndex | undefined;
  /** The document. */
  readonly source: SelectionSource;
  /**
   * The dragged objects: they and everything inside them are never candidates. A set is used
   * as it is, so a caller that keeps one for its gesture (`DragSnapper`) builds it once.
   */
  readonly movingIds: readonly ObjectId[] | ReadonlySet<ObjectId>;
  /** The selection frame when the drag began; a move without one does not snap. */
  readonly start: OrientedBox | undefined;
  /** The camera zoom, CSS px per world unit: the threshold and the grid follow it. */
  readonly zoom: number;
  /** What is on screen, world units; candidates are looked for everywhere if absent. */
  readonly viewport?: WorldBounds | undefined;
  /**
   * The gesture's cache of candidates' boxes (`SnapCandidateQuery.boxes`), so a step computes
   * only the boxes it has not met; none if absent.
   */
  readonly boxes?: Map<ObjectId, WorldBounds | null>;
}

/** The whole board, for a request with no viewport. */
const EVERYWHERE: WorldBounds = {
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

/**
 * The context one drag step snaps in: candidates from the index near the box (two band queries
 * clipped to the viewport, `snapCandidatesNear`), 6 CSS px of reach in world units, and the
 * grid at the zoom's spacing when it shows.
 *
 * @param request - The step's settings, index, selection, zoom and viewport.
 * @returns The context.
 */
function contextOf(request: DragSnapRequest): DragSnapContext {
  const { index, source, zoom, settings } = request;
  const thresholdWorld = snapThresholdAt(zoom);
  const { movingIds } = request;
  let moving: ReadonlySet<ObjectId> | undefined = movingIds instanceof Set ? movingIds : undefined;
  const viewport = request.viewport ?? EVERYWHERE;
  const query = request.boxes
    ? { viewport, thresholdWorld, boxes: request.boxes }
    : { viewport, thresholdWorld };
  return {
    candidatesNear: (box) =>
      index === undefined
        ? []
        : snapCandidatesNear(index, source, box, (moving ??= new Set(movingIds)), query),
    thresholdWorld,
    grid: settings.isGridVisible ? { spacing: gridSpacingAt(zoom) } : undefined,
  };
}

/**
 * Snaps a drag step of the select tool: moves and
 * resizes (`snapMove`, `snapResize`) while snapping is on and the snap modifier is not held;
 * rotations never snap here (Shift gives them 15° steps). Pure: reads the index and the
 * document.
 *
 * @param intent - The drag's intent, measured from the press.
 * @param request - What it snaps with.
 * @returns The intent to preview and commit, and the guides to show.
 */
export function snapTransform(
  intent: TransformIntent,
  request: DragSnapRequest,
): SnappedDrag<TransformIntent> {
  if (!request.settings.isEnabled || request.isSuspended) return { intent, guides: [] };
  if (intent.type === 'resize') return snapResize(intent, contextOf(request));
  if (intent.type === 'move' && request.start) {
    return snapMove(intent, request.start, contextOf(request));
  }
  return { intent, guides: [] };
}

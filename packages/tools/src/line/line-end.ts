import { gridSpacingAt, type WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { SnapSettings } from '../select/drag-snap.js';
import type { SelectPointer } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';
import { snapCandidatesNear, type SnapIndex } from '../snap/snap-candidates.js';
import type { SnapGuide } from '../snap/snap-guide.js';
import { snapPoint } from '../snap/snap-point.js';
import { snapThresholdAt } from '../snap/snap-threshold.js';

import { constrainLineEnd } from './angle-constraint.js';
import { nearestAnchor } from './line-anchors.js';

/** What a line end snaps against, for one pointer input. */
export interface LineEndContext {
  /** The spatial index anchors and snapping candidates come from; the grid only if absent. */
  readonly index: SnapIndex | undefined;
  /** The document. */
  readonly source: SelectionSource;
  /** The objects never snapped to: the line being edited. */
  readonly excludedIds: ReadonlySet<ObjectId>;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The person's snapping preferences; nothing snaps when absent. */
  readonly snapping: SnapSettings | undefined;
  /** What is on screen, world units: edges and centres snap only to objects in it. */
  readonly viewport: WorldBounds | undefined;
}

/** Where a line end goes, and what it snapped to. */
export interface LineEnd {
  /** The end, world units. */
  readonly point: Point;
  /** The anchor it landed on, if it did (drawn as a marker). */
  readonly anchor: Point | undefined;
  /** The guides through the lines it snapped to, when it snapped to edges or centres. */
  readonly guides: readonly SnapGuide[];
}

const NO_GUIDES: readonly SnapGuide[] = Object.freeze([]);

/**
 * Where a line end goes for a pointer: with Shift held and another end fixed, turned to the nearest
 * 45° about it (`constrainLineEnd`), which nothing then moves; otherwise, while snapping is on and
 * the snap modifier (Alt, Option on a Mac) is not held, onto the nearest object anchor within 8 CSS
 * px (`nearestAnchor`), else onto the edges and centres of objects on screen and the grid while it
 * shows (`snapPoint`, 6 CSS px). The end is a free point either way: nothing is attached. Pure:
 * reads the index and the document.
 *
 * @param pointer - The pointer, with its world point and modifiers.
 * @param fixed - The line's other end, when there is one (not at the press that starts a line).
 * @param context - The index, the document, the zoom, the preferences and the view.
 * @returns The end and what it snapped to.
 */
export function lineEndAt(
  pointer: SelectPointer,
  fixed: Point | undefined,
  context: LineEndContext,
): LineEnd {
  const { world } = pointer;
  if (fixed && pointer.isShiftPressed) {
    return { point: constrainLineEnd(fixed, world), anchor: undefined, guides: NO_GUIDES };
  }
  const { snapping, index, source, zoom } = context;
  if (!snapping?.isEnabled || pointer.isSnapSuspended === true) {
    return { point: world, anchor: undefined, guides: NO_GUIDES };
  }
  const anchor =
    index && nearestAnchor(index, source, world, { zoom, excludedIds: context.excludedIds });
  if (anchor) return { point: anchor, anchor, guides: NO_GUIDES };
  const thresholdWorld = snapThresholdAt(zoom);
  const { viewport } = context;
  const candidates =
    index && viewport
      ? snapCandidatesNear(
          index,
          source,
          { minX: world.x, minY: world.y, maxX: world.x, maxY: world.y },
          context.excludedIds,
          { viewport, thresholdWorld },
        )
      : [];
  const grid = snapping.isGridVisible ? { spacing: gridSpacingAt(zoom) } : undefined;
  const snapped = snapPoint(world, candidates, thresholdWorld, grid);
  return { point: snapped.point, anchor: undefined, guides: snapped.guides };
}

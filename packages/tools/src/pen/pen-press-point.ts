import type { PathNetwork, WorldBounds } from '@canvas/engine';
import type { ObjectId, Point, Vertex } from '@canvas/schema';

import type { SnapSettings } from '../select/drag-snap.js';
import type { SnapGuide } from '../snap/snap-guide.js';

import { constrain45 } from './constrain-45.js';
import {
  hitSegment,
  hitVertex,
  SEGMENT_HIT_TOLERANCE_PX,
  VERTEX_HIT_TOLERANCE_PX,
} from './network-hit.js';
import type { PenModeContext } from './pen-context.js';

/** Where a pen press lands after Shift and snapping, and the guides to show. */
export interface PenPressPoint {
  /** The point, local units for a press on a path, world units for {@link snapPenWorld}. */
  readonly point: Point;
  /** The snap guides through it; empty when it did not snap. */
  readonly guides: readonly SnapGuide[];
}

/** How a press snaps: the context's snapper, the input's settings and the zoom. */
export interface PenSnapping {
  /** The context's snapper, if any. */
  readonly snap: PenModeContext['snapPoint'];
  /** The press's snapping settings, if the caller gave them. */
  readonly settings: SnapSettings | undefined;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** Objects not to snap to: the path being drawn. */
  readonly excludedIds: ReadonlySet<ObjectId>;
  /** What is on screen, world units; everywhere if absent. */
  readonly viewport?: WorldBounds | undefined;
}

/**
 * A world point snapped to nearby objects and the grid while snapping is
 * on; the point itself otherwise.
 *
 * @param world - The point, world units.
 * @param snapping - The snapper, settings, zoom and exclusions.
 * @returns The point, world units, and its guides.
 */
export function snapPenWorld(world: Point, snapping: PenSnapping): PenPressPoint {
  const { snap, settings, zoom, excludedIds, viewport } = snapping;
  if (!snap || !settings?.isEnabled) return { point: world, guides: [] };
  return snap(world, { zoom, settings, excludedIds, viewport });
}

/**
 * Where a pen press on a path lands, in the path's frame: on 45° steps from the chain's vertex
 * while Shift is held; else, when it would place a new vertex (on no vertex or segment of the
 * path), snapped. Alt breaks mirroring in the pen and never suspends snapping.
 *
 * @param network - The path's network.
 * @param world - The press, world units.
 * @param toLocal - Converts a world point to the path's frame.
 * @param from - The chain's vertex, if a chain is active.
 * @param isShiftPressed - Whether Shift is held.
 * @param snapping - The snapper, settings, zoom and exclusions.
 * @returns The point, local units, and its guides.
 */
export function penPressPoint(
  network: PathNetwork,
  world: Point,
  toLocal: (point: Point) => Point,
  from: Vertex | undefined,
  isShiftPressed: boolean,
  snapping: PenSnapping,
): PenPressPoint {
  const local = toLocal(world);
  if (isShiftPressed && from) return { point: constrain45(from, local), guides: [] };
  const { zoom } = snapping;
  const isOnNetwork =
    hitVertex(network, local, VERTEX_HIT_TOLERANCE_PX / zoom) !== undefined ||
    hitSegment(network, local, SEGMENT_HIT_TOLERANCE_PX / zoom) !== undefined;
  if (isOnNetwork) return { point: local, guides: [] };
  const snapped = snapPenWorld(world, snapping);
  return { point: toLocal(snapped.point), guides: snapped.guides };
}

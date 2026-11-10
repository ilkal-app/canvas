import { sortTopmostFirst, type SpatialSearch, type WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import {
  boxCentreOf,
  boxCornersOf,
  isInsideBox,
  normalizeAngle,
  worldPointToBox,
  type OrientedBox,
} from '../select/oriented-box.js';
import {
  groupsHoldingLocked,
  orientedBoxOf,
  type SelectionSource,
} from '../select/selection-geometry.js';
import type { ShapeBox } from '../shape/new-shape-object.js';

// Where a drawn frame goes and what it takes in. The
// frame goes into the top-most frame under the centre of the drawn box that the box does not
// enclose, as a moved object lands, or onto the root: a frame wholly inside the box
// (and anything inside such a frame) is taken in, never made the parent. It takes in every object wholly inside the drawn box that sits on
// the root or in that same parent frame; a child of another frame moves only with its frame,
// when that frame is wholly inside too. Locked objects, and groups holding one, stay where they
// are (they cannot be moved), as do objects the engine does not draw.

/** Where the frame tool's frame goes, and what it takes in. */
export interface FramePlacement {
  /** The frame it goes in, or `null` for the board root. */
  readonly parentId: ObjectId | null;
  /** Its origin (the drawn box's top-left) in that parent's frame, world units. */
  readonly origin: Point;
  /** Its rotation in that parent's frame, so it is upright on the board, radians. */
  readonly rotation: number;
  /** The objects it takes in, in no particular order. */
  readonly childIds: readonly ObjectId[];
}

/** Where the frame tool looks objects up: the select tool's index and document. */
export interface FramePlacementSource {
  /** The spatial index over the objects' world boxes. */
  readonly index: SpatialSearch;
  /** The document the index mirrors. */
  readonly source: SelectionSource;
}

/**
 * The drawn box as world bounds.
 *
 * @param box - The box, world units.
 * @returns Its bounds.
 */
function boundsOf(box: ShapeBox): WorldBounds {
  return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
}

/**
 * Whether an object's box lies wholly inside the drawn bounds.
 *
 * @param box - The object's box on the board.
 * @param bounds - The drawn bounds.
 * @returns True when every corner is inside.
 */
function isWhollyInside(box: OrientedBox, bounds: WorldBounds): boolean {
  return boxCornersOf(box).every(
    ({ x, y }) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY,
  );
}

/**
 * Whether a frame, or a frame above it, lies wholly inside the drawn bounds: the new frame takes
 * it in (or it moves with the frame that is taken in), so it cannot be the new frame's parent.
 * A parent cycle ends the walk.
 *
 * @param id - The frame.
 * @param bounds - The drawn bounds.
 * @param source - The document.
 * @returns True when it or an ancestor is enclosed.
 */
function isEnclosed(id: ObjectId, bounds: WorldBounds, source: SelectionSource): boolean {
  const seen = new Set<ObjectId>();
  for (let current: ObjectId | null = id; current !== null && !seen.has(current);) {
    seen.add(current);
    const object = source.get(current);
    if (object === undefined) return false;
    const box = object.type === 'frame' ? orientedBoxOf(current, source) : undefined;
    if (box !== undefined && isWhollyInside(box, bounds)) return true;
    current = object.parentId;
  }
  return false;
}

/**
 * The top-most frame under a point that the drawn box does not enclose, as a moved object's
 * landing is found: a frame wholly inside the box (or inside such a frame) is taken in instead.
 *
 * @param point - The point, world units.
 * @param bounds - The drawn bounds.
 * @param board - The index and document.
 * @returns The frame's id and box, or undefined over bare board.
 */
function frameUnder(
  point: Point,
  bounds: WorldBounds,
  board: FramePlacementSource,
): { readonly id: ObjectId; readonly box: OrientedBox } | undefined {
  const { index, source } = board;
  const near = index.searchRect({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });
  const frames = near.filter((id) => {
    if (source.get(id)?.type !== 'frame' || source.isDrawable?.(id) === false) return false;
    if (isEnclosed(id, bounds, source)) return false;
    const box = orientedBoxOf(id, source);
    return box !== undefined && isInsideBox(box, point);
  });
  const id = sortTopmostFirst(frames, source)[0];
  const box = id === undefined ? undefined : orientedBoxOf(id, source);
  return id === undefined || box === undefined ? undefined : { id, box };
}

/**
 * Plans a drawn frame: its parent, its placement there, and the objects it takes in. Pure:
 * reads the index and the document; O(objects the drawn box reaches) plus one point query.
 *
 * @param box - The drawn box, world units, upright on the board.
 * @param board - The index and document.
 * @returns The placement.
 */
export function planFramePlacement(box: ShapeBox, board: FramePlacementSource): FramePlacement {
  const { index, source } = board;
  const bounds = boundsOf(box);
  const parent = frameUnder(boxCentreOf({ ...box, rotation: 0 }), bounds, board);
  const parentId = parent?.id ?? null;
  const topLeft = { x: box.x, y: box.y };
  const origin = parent === undefined ? topLeft : worldPointToBox(parent.box, topLeft);
  const rotation = parent === undefined ? 0 : normalizeAngle(0 - parent.box.rotation);
  const candidates = index.searchRect(bounds).filter((id) => {
    const object = source.get(id);
    if (object === undefined || object.locked || id === parentId) return false;
    if (object.parentId !== null && object.parentId !== parentId) return false;
    if (source.isDrawable?.(id) === false) return false;
    const objectBox = orientedBoxOf(id, source);
    return objectBox !== undefined && isWhollyInside(objectBox, bounds);
  });
  const held = new Set(groupsHoldingLocked(candidates, source));
  const childIds = [...new Set(candidates)].filter((id) => !held.has(id));
  return { parentId, origin, rotation, childIds };
}

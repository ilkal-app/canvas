import {
  coordinateReason,
  freehandPointsOf,
  type BoardObject,
  type ObjectId,
  type PathObject,
} from '@canvas/schema';

import type { SceneSource } from '../scene/scene-source.js';

import { DRAWABLE_EXTENT, type UndrawableReason } from './drawable-extent.js';
import { ownUndrawableReason } from './drawable-fields.js';
import { BOARD, isPlacedWithin, placeInto, type Placement } from './drawable-placement.js';

/**
 * The frame of the object judged last, reused: judging an object that holds no children
 * allocates nothing (fix round 1). The engine's thread runs one judgement at a time.
 */
const SCRATCH: Placement = { cos: 1, sin: 0, x: 0, y: 0 };

/**
 * Whether a path's vertices and handle points (the hull of its curves, as the schema's
 * `localBounds` measures it) lie within the extent.
 *
 * @param path - The path.
 * @param placement - Its frame on the board.
 * @returns True when they do.
 */
function isPathWithin(path: PathObject, placement: Placement): boolean {
  const byId = new Map(path.vertices.map((vertex) => [vertex.id, vertex]));
  for (const vertex of path.vertices) {
    if (!isPlacedWithin(placement, vertex.x, vertex.y)) return false;
  }
  for (const { a, b, ha, hb } of path.segments) {
    const start = byId.get(a);
    const end = byId.get(b);
    if (start && !isPlacedWithin(placement, start.x + ha.x, start.y + ha.y)) return false;
    if (end && !isPlacedWithin(placement, end.x + hb.x, end.y + hb.y)) return false;
  }
  return true;
}

/**
 * Whether an object's geometry, placed on the board, lies within the extent: a boxed object's
 * corners, a line's ends, a path's hull, and the origin of a group, connector or comment, which
 * have no geometry of their own. A stroke's reach past its geometry is not counted, so an honest
 * object at the edge keeps its outline.
 *
 * @param object - The object.
 * @param placement - Its frame on the board.
 * @returns True when it lies within ±{@link DRAWABLE_EXTENT}.
 */
function isWithinExtent(object: BoardObject, placement: Placement): boolean {
  switch (object.type) {
    case 'line': {
      const [start, end] = object.points;
      return isPlacedWithin(placement, start.x, start.y) && isPlacedWithin(placement, end.x, end.y);
    }
    case 'path':
      return isPathWithin(object, placement);
    case 'freehand':
      return freehandPointsOf(object.points).every(({ x, y }) => isPlacedWithin(placement, x, y));
    case 'group':
    case 'connector':
    case 'comment':
      return isPlacedWithin(placement, 0, 0);
    default: {
      const { width, height } = object;
      return (
        isPlacedWithin(placement, 0, 0) &&
        isPlacedWithin(placement, width, 0) &&
        isPlacedWithin(placement, width, height) &&
        isPlacedWithin(placement, 0, height)
      );
    }
  }
}

/** What judging an object found: its reason, if any, and its frame on the board. */
export interface Judgement {
  readonly reason: UndrawableReason | undefined;
  readonly placement: Placement;
}

/**
 * Judgements already made during one pass over a change set, by object id, so a frame's many
 * children judge it once (`DrawableGate`).
 */
export type DrawableMemo = Map<ObjectId, Judgement>;

/** The board: drawable, its own frame. */
const BOARD_JUDGEMENT: Judgement = { reason: undefined, placement: BOARD };

/**
 * Judges one object on the board, its parent judged: its parent's failure, else its own fields,
 * else its geometry in its frame.
 *
 * @param object - The object.
 * @param parent - Its parent's judgement (the board's at the root).
 * @returns The object's judgement.
 */
function judgeUnder(object: BoardObject, parent: Judgement): Judgement {
  const placement = placeInto({ ...BOARD }, parent.placement, object);
  if (parent.reason !== undefined) return { reason: 'undrawable-parent', placement };
  const own = ownUndrawableReason(object);
  if (own !== undefined) return { reason: own, placement };
  return { reason: isWithinExtent(object, placement) ? undefined : 'past-extent', placement };
}

/**
 * Judges an object and every ancestor not judged yet, from the board down. The walk up stops at
 * a parent the source does not hold and at a parent cycle, as `worldTransformOf` does, and at an
 * ancestor the memo holds. Iterative, so a deep chain of frames cannot overflow the stack.
 *
 * @param object - The object.
 * @param source - The document.
 * @param memo - Judgements already made, filled in; none kept when absent.
 * @returns The object's judgement.
 */
function judgementOf(
  object: BoardObject,
  source: SceneSource,
  memo: DrawableMemo | undefined,
): Judgement {
  const known = memo?.get(object.id);
  if (known !== undefined) return known;
  const chain = [object];
  let base = BOARD_JUDGEMENT;
  if (object.parentId !== null) {
    const visited = new Set<ObjectId>([object.id]);
    let parent = source.get(object.parentId);
    while (parent !== undefined && !visited.has(parent.id)) {
      const judged = memo?.get(parent.id);
      if (judged !== undefined) {
        base = judged;
        break;
      }
      visited.add(parent.id);
      chain.push(parent);
      parent = parent.parentId === null ? undefined : source.get(parent.parentId);
    }
  }
  let judgement = base;
  for (const node of chain.reverse()) {
    judgement = judgeUnder(node, judgement);
    // Only frames and groups hold children, so only their judgements are asked for again.
    if (node.type === 'frame' || node.type === 'group') memo?.set(node.id, judgement);
  }
  return judgement;
}

/**
 * Why an object cannot be drawn, if it cannot: its own fields
 * (`ownUndrawableReason`), its geometry on the board (every hull point within
 * ±{@link DRAWABLE_EXTENT}), and every frame or group it sits in, each judged the same way from
 * the board down, so a child of an undrawable parent is undrawable too: its place on the board
 * cannot be worked out. The one rule every reader of stored geometry in the engine follows: an
 * object it gives a reason for is absent, never indexed, culled, drawn, hit or measured. Pure;
 * O(depth + the object's points), no curve is flattened.
 *
 * @param object - The object; not mutated.
 * @param source - The document, for its ancestors.
 * @returns The reason, or undefined when the object is drawable.
 */
export function undrawableReasonOf(
  object: BoardObject,
  source: SceneSource,
): UndrawableReason | undefined {
  return judgementOf(object, source, undefined).reason;
}

/**
 * {@link undrawableReasonOf} within one pass over one document state: judgements of frames and
 * groups are reused and filled in, so a frame's many children judge it once (`DrawableGate`).
 * Internal to the engine.
 *
 * @param object - The object; not mutated.
 * @param source - The document, for its ancestors.
 * @param memo - The pass's judgements so far.
 * @returns The reason, or undefined when the object is drawable.
 */
export function undrawableReasonIn(
  object: BoardObject,
  source: SceneSource,
  memo: DrawableMemo,
): UndrawableReason | undefined {
  // Frames and groups are judged whole and remembered, for their children.
  if (object.type === 'frame' || object.type === 'group') {
    return judgementOf(object, source, memo).reason;
  }
  const parent = object.parentId === null ? undefined : source.get(object.parentId);
  const judged =
    parent === undefined || parent.id === object.id ? BOARD_JUDGEMENT : memo.get(parent.id);
  // A parent not judged yet in this pass: the whole chain, remembered.
  if (judged === undefined) return judgementOf(object, source, memo).reason;
  if (judged.reason !== undefined) return 'undrawable-parent';
  const own = ownUndrawableReason(object);
  if (own !== undefined) return own;
  const placement = placeInto(SCRATCH, judged.placement, object);
  return isWithinExtent(object, placement) ? undefined : 'past-extent';
}

/**
 * Whether the engine draws an object: {@link undrawableReasonOf} finds nothing wrong with it.
 *
 * @param object - The object.
 * @param source - The document, for its ancestors.
 * @returns True when it is drawable.
 */
export function isDrawableIn(object: BoardObject, source: SceneSource): boolean {
  return undrawableReasonOf(object, source) === undefined;
}

/**
 * Judges a proven root leaf's changing coordinates and exact world extent. The caller owns
 * the cached verdict for its unchanged fields; coordinate failures still take precedence.
 *
 * @param object - Root leaf with only x/y changed.
 * @param fixedReason - Its unchanged field verdict.
 * @returns The ordinary reason for this placement.
 */
export function rootMoveReason(
  object: BoardObject,
  fixedReason: UndrawableReason | undefined,
): UndrawableReason | undefined {
  const own = coordinateReason(object.x) ?? coordinateReason(object.y) ?? fixedReason;
  if (own !== undefined) return own;
  return isWithinExtent(object, placeInto(SCRATCH, BOARD, object)) ? undefined : 'past-extent';
}

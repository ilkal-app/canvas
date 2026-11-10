import {
  applyTransform,
  BOARD_BOUND,
  finiteCoordinate,
  invertTransform,
  isFiniteTransform,
  parentToBoardTransform,
  type Board,
  type BoardObject,
  type Point,
  type RigidTransform,
} from '@canvas/schema';

/**
 * Runs a computation that walks chains of parents with the schema's rules, which throw a
 * `RangeError` when the chain loops (a state concurrent reparenting can leave on a board).
 *
 * @param compute - The computation.
 * @returns Its value, or `null` when it met a parent cycle.
 * @throws {unknown} Anything else the computation throws.
 */
export function unlessParentCycle<Value>(compute: () => Value): Value | null {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * Makes a computed point storable: coordinates that are finite are kept as they are, past the
 * board's bound too, and only what is not finite is clamped (`finiteCoordinate`). A
 * stored ancestor or object far from the origin can overflow the arithmetic of a frame change.
 *
 * @param point - The computed point.
 * @returns The point with every coordinate finite.
 */
function finitePoint(point: Point): Point {
  return { x: finiteCoordinate(point.x), y: finiteCoordinate(point.y) };
}

/**
 * The transform from an object's parent frame to the board, or `null` on a parent cycle.
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @returns The transform, or `null`.
 */
function parentTransformOf(board: Board, object: BoardObject): RigidTransform | null {
  return unlessParentCycle(() => parentToBoardTransform(board, object));
}

/**
 * Maps a point in board coordinates into the frame of an object's parent, the frame its `x`
 * and `y` are in (coordinates are relative to the parent).
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param point - The point, world units in the board's frame.
 * @returns The point in the parent's frame, or `null` when the ancestors form a cycle.
 */
export function boardToParentFrame(board: Board, object: BoardObject, point: Point): Point | null {
  const parentToBoard = parentTransformOf(board, object);
  return parentToBoard === null
    ? null
    : finitePoint(applyTransform(invertTransform(parentToBoard), point));
}

/**
 * Maps a point in the frame of an object's parent to board coordinates.
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param point - The point, world units in the parent's frame.
 * @returns The point in the board's frame, or `null` when the ancestors form a cycle.
 */
export function parentFrameToBoard(board: Board, object: BoardObject, point: Point): Point | null {
  const parentToBoard = parentTransformOf(board, object);
  return parentToBoard === null ? null : finitePoint(applyTransform(parentToBoard, point));
}

/**
 * How far a board point may land from where it was asked for, after a round trip through a
 * parent's frame, world units: far above the rounding of any frame within twice the board's bound
 * (2^-21), far below what a person sees.
 */
const PLACE_TOLERANCE = 2 ** -10;

/**
 * Tells whether an object's parent frame can hold a board point: its transform to the
 * board is finite, and the point comes back from it within {@link PLACE_TOLERANCE}. A frame placed
 * so far away that its numbers swallow the point (an ancestor at 1e300), or one that is not finite
 * at all, cannot: a move `to` a point inside the bound then takes the object out of it.
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param point - The point, world units in the board's frame.
 * @returns `true` when the parent's frame can hold it, and when the ancestors form a cycle (a
 *   refusal of its own).
 */
export function canHoldPoint(board: Board, object: BoardObject, point: Point): boolean {
  const parentToBoard = parentTransformOf(board, object);
  if (parentToBoard === null) return true;
  if (!isFiniteTransform(parentToBoard)) return false;
  const back = applyTransform(parentToBoard, applyTransform(invertTransform(parentToBoard), point));
  return (
    Math.abs(back.x - point.x) <= PLACE_TOLERANCE && Math.abs(back.y - point.y) <= PLACE_TOLERANCE
  );
}

/**
 * Tells whether an object's position cannot be carried through the board frame without losing
 * it: an ancestor puts the parent frame past the board's bound, or the object itself is stored
 * past it, or a stored value is not finite. The board frame adds the offset of such a position
 * to a number of its own size, and taking it away again cancels everything but that offset: the
 * object lands near 0, or far off, whatever the person asked.
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @returns `true` when the round trip through the board frame is not to be trusted; `false` when
 *   it is, and when the ancestors form a cycle.
 */
export function isFarPlaced(board: Board, object: BoardObject): boolean {
  const parentToBoard = parentTransformOf(board, object);
  if (parentToBoard === null) return false;
  const isNear = (value: number): boolean => Math.abs(value) <= BOARD_BOUND;
  return !(
    isNear(parentToBoard.x) &&
    isNear(parentToBoard.y) &&
    isNear(object.x) &&
    isNear(object.y)
  );
}

/**
 * Where a displacement in board coordinates puts an object's local origin, in its parent's frame.
 * An honest board goes through the board frame exactly as `parentFrameToBoard` and
 * `boardToParentFrame` do. When the object is placed far ({@link isFarPlaced}) that round trip
 * would cancel its own position away; the displacement is instead turned into the parent's frame
 * (the transform's rotation only) and added to the stored position.
 *
 * @param board - A board holding the object's chain of ancestors.
 * @param object - The object.
 * @param by - The displacement, world units in the board's frame.
 * @returns The new `x` and `y`, or `null` when the ancestors form a cycle.
 */
export function movedByInParentFrame(board: Board, object: BoardObject, by: Point): Point | null {
  const parentToBoard = parentTransformOf(board, object);
  if (parentToBoard === null) return null;
  if (isFarPlaced(board, object)) {
    return finitePoint({
      x: object.x + parentToBoard.cos * by.x + parentToBoard.sin * by.y,
      y: object.y - parentToBoard.sin * by.x + parentToBoard.cos * by.y,
    });
  }
  const origin = applyTransform(parentToBoard, { x: object.x, y: object.y });
  return finitePoint(
    applyTransform(invertTransform(parentToBoard), { x: origin.x + by.x, y: origin.y + by.y }),
  );
}

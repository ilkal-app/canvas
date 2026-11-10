import type { ObjectId, Point, Rect } from '@canvas/schema';

/**
 * One object as the arrange planners see it:
 * the axis-aligned rectangle round its box in the frame the selection is arranged in (the
 * common parent's, or the board's), world units. A turned object counts by its turned corners.
 */
export interface ArrangeBox extends Rect {
  /** The object. */
  readonly id: ObjectId;
}

/** How far a planner moves one object, in the frame its box was given in. */
export interface ArrangeMove {
  /** The object. */
  readonly id: ObjectId;
  /** The displacement, world units; never (0, 0). */
  readonly delta: Point;
}

/**
 * The smallest axis-aligned rectangle holding every box. Pure.
 *
 * @param boxes - The boxes.
 * @returns The rectangle, or undefined for no boxes.
 */
export function boundsOfBoxes(boxes: readonly Rect[]): Rect | undefined {
  if (boxes.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The move that takes a box's top-left corner to a point, or nothing when it is already there.
 *
 * @param box - The box.
 * @param to - Where its top-left corner goes, world units.
 * @returns The move, as a list of zero or one.
 */
export function moveBoxTo(box: ArrangeBox, to: Point): ArrangeMove[] {
  const delta = { x: to.x - box.x, y: to.y - box.y };
  return delta.x === 0 && delta.y === 0 ? [] : [{ id: box.id, delta }];
}

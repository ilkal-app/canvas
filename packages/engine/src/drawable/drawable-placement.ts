import type { BoardObject } from '@canvas/schema';

import { DRAWABLE_EXTENT } from './drawable-extent.js';

/** An object's frame on the board: rotate by the angle of `cos`, `sin`, then move by `x`, `y`. */
export interface Placement {
  cos: number;
  sin: number;
  x: number;
  y: number;
}

/** The board's own frame. */
export const BOARD: Readonly<Placement> = { cos: 1, sin: 0, x: 0, y: 0 };

/**
 * Writes an object's frame on the board, from its parent's, as `worldTransformOf` composes it.
 *
 * @param target - Where to write it.
 * @param parent - The parent's frame on the board.
 * @param object - The object.
 * @returns `target`.
 */
export function placeInto(
  target: Placement,
  parent: Readonly<Placement>,
  object: BoardObject,
): Placement {
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  const { x, y } = object;
  const worldX = parent.cos * x - parent.sin * y + parent.x;
  const worldY = parent.sin * x + parent.cos * y + parent.y;
  target.cos = parent.cos * cos - parent.sin * sin;
  target.sin = parent.sin * cos + parent.cos * sin;
  target.x = worldX;
  target.y = worldY;
  return target;
}

/**
 * Whether a point of an object's own frame, placed on the board, lies within the extent. Written
 * so NaN fails: every comparison with NaN is false.
 *
 * @param placement - The object's frame on the board.
 * @param x - The point's x in the object's frame.
 * @param y - The point's y in the object's frame.
 * @returns True when it lies within ±{@link DRAWABLE_EXTENT} on both axes.
 */
export function isPlacedWithin(placement: Placement, x: number, y: number): boolean {
  const boardX = placement.cos * x - placement.sin * y + placement.x;
  const boardY = placement.sin * x + placement.cos * y + placement.y;
  return Math.abs(boardX) <= DRAWABLE_EXTENT && Math.abs(boardY) <= DRAWABLE_EXTENT;
}

import { DRAWABLE_EXTENT } from '@canvas/engine';

import type { OrientedBox } from './oriented-box.js';

/**
 * Whether a point lies within the engine's drawable extent. NaN does not.
 *
 * @param x - World x.
 * @param y - World y.
 * @returns True when both lie within ±`DRAWABLE_EXTENT`.
 */
function isWithinExtent(x: number, y: number): boolean {
  return Math.abs(x) <= DRAWABLE_EXTENT && Math.abs(y) <= DRAWABLE_EXTENT;
}

/**
 * Whether a box can be outlined when no gate has judged its object (the app passes the
 * hit gate's verdict, `SelectionSource.isDrawable`, and this is the fallback for sources without
 * one): a turn that is a number, a size that is not negative, four corners within the drawable
 * extent. A box worked out from a value a peer wrote past the command layer (NaN, an infinity, a
 * place past the extent, a negative size, in the object or a frame or group around it) is not.
 * O(1): the turn's cosine and sine are the world transform's, not recomputed.
 *
 * @param box - The box.
 * @param cos - The cosine of its turn.
 * @param sin - The sine of its turn.
 * @returns True when it can be outlined.
 */
export function isDrawableBox(box: OrientedBox, cos: number, sin: number): boolean {
  const { x, y, width, height, rotation } = box;
  if (!(width >= 0 && height >= 0 && Number.isFinite(rotation))) return false;
  return (
    isWithinExtent(x, y) &&
    isWithinExtent(x + width * cos, y + width * sin) &&
    isWithinExtent(x + width * cos - height * sin, y + width * sin + height * cos) &&
    isWithinExtent(x - height * sin, y + height * cos)
  );
}

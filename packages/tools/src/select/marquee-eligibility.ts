import type { HitRectMode, WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { boxCornersOf } from './oriented-box.js';
import { orientedBoxOf, type SelectionSource } from './selection-geometry.js';

/**
 * Whether an object's box lies wholly inside a rectangle.
 *
 * @param id - The object whose box to test (a group's derived from its children).
 * @param rect - The rectangle, world units.
 * @param source - The document.
 * @returns True when every corner is inside.
 */
function isEnclosed(id: ObjectId, rect: WorldBounds, source: SelectionSource): boolean {
  const box = orientedBoxOf(id, source);
  return (
    box !== undefined &&
    boxCornersOf(box).every(
      ({ x, y }) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY,
    )
  );
}

/**
 * Whether a marquee may take an object the engine's `hitRect` found (as the select target,
 * `selectTargetOf`): a frame only when the marquee encloses it, whichever way it was dragged, so a
 * marquee over part of a frame takes the children it reaches instead; a group on touch dragging
 * right (`intersect`) and only when enclosed dragging left (`contain`), since its children, not
 * the group, were hit; anything else as the engine found it. Pure.
 *
 * @param id - The object.
 * @param rect - The marquee, world units.
 * @param mode - Touching or enclosing.
 * @param source - The document.
 * @returns True when the marquee takes it; false for an object not in the document.
 */
export function isMarqueeEligible(
  id: ObjectId,
  rect: WorldBounds,
  mode: HitRectMode,
  source: SelectionSource,
): boolean {
  switch (source.get(id)?.type) {
    case undefined:
      return false;
    case 'frame':
      return isEnclosed(id, rect, source);
    case 'group':
      return mode === 'intersect' || isEnclosed(id, rect, source);
    default:
      return true;
  }
}

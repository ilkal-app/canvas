import {
  boardTransformOf,
  composeTransforms,
  isFiniteTransform,
  placementTransform,
  type BoardObject,
  type ObjectId,
  type RigidTransform,
} from '@canvas/schema';

import type { BoxSource } from './box-source.js';
import { isPastBound } from './extent-rule.js';
import { worldBoxAt } from './world-box.js';

/**
 * Tells whether an object is far (rule 5 of the board's bound): its box on the board
 * (`worldBoxOf`), or the box of anything it carries (its descendants, which move, turn and scale
 * with it), has an extent past ±`BOARD_BOUND`, or a number it needs is not finite, or its box
 * cannot be worked out (a parent cycle; an ancestor that is not finite). Storing a number past the
 * bound does not make an object far: a member of a group of two frames at -B and +B stores about
 * 2B and lies inside the bound. The one test the select tool (which skips far objects in a
 * transform and says so), the command layer and the sync fuzz's model share. O(depth + subtree).
 *
 * @param source - The board.
 * @param id - The object's id.
 * @returns `true` when the object is far; `false` for one that is not, or is not on the board.
 */
export function isFarObject(source: BoxSource, id: ObjectId): boolean {
  const object = source.get(id);
  if (object === undefined) return false;
  const transform = boardTransformOf(object, (key) => source.get(key));
  if (transform === undefined) return true;
  const seen = new Set<ObjectId>();
  const pending: [BoardObject, RigidTransform][] = [[object, transform]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [current, toBoard] = next;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    if (isPastBound(worldBoxAt(current, toBoard))) return true;
    for (const childId of source.childrenOf(current.id)) {
      const child = source.get(childId);
      if (child === undefined) continue;
      const toChild = composeTransforms(
        toBoard,
        placementTransform(child.x, child.y, child.rotation),
      );
      if (!isFiniteTransform(toChild)) return true;
      pending.push([child, toChild]);
    }
  }
  return false;
}

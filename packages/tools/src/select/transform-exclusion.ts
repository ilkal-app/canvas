import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

/**
 * Whether a transform (a move, nudge, rotation, resize, alignment, distribution or tidy) leaves
 * a selected object out, the one rule every transform follows: it is placed far away
 * (`isFarObject`: a box on the board past the bound or not computable, its own or a
 * descendant's), or the engine does not draw it (`SelectionSource.isDrawable`: the
 * app's hit gate holds it undrawable, for a value no command writes, such as a colour of 1e39).
 * The commands validate what they write and would refuse the whole command for either, so the
 * rest of the selection moves and these stay where they are. Delete does not use it: both kinds
 * can always be deleted. O(1).
 *
 * @param id - The selected object.
 * @param source - The document, with the hit gate's verdict when there is one.
 * @param far - The selected objects that are far.
 * @returns True when a transform leaves the object where it is.
 */
export function isLeftOutOfTransforms(
  id: ObjectId,
  source: SelectionSource,
  far: ReadonlySet<ObjectId>,
): boolean {
  return far.has(id) || source.isDrawable?.(id) === false;
}

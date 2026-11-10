import type { ObjectId } from '@canvas/schema';

import type { SceneSource } from '../scene/scene-source.js';
import { compareStacking, type StackingKey } from '../scene/segments/stacking-order.js';

/**
 * Orders objects topmost first, as the board paints them (z-order is a
 * fractional index among siblings): every object is placed by its stacking path, the z keys from
 * its root ancestor down to itself, compared step by step with `compareStacking` (z, then id),
 * the comparison the z-order segments stage paints by, so pick order cannot diverge from draw
 * order: a child is above its parent and each subtree stacks as a unit. `compareStacking` is
 * the schema's `compareSiblings`, the rule the document orders siblings by.
 *
 * @param ids - The objects; not mutated.
 * @param source - The document, to read objects and ancestors from; ids it lacks are dropped.
 * @returns The ids present in the document, topmost first; a new array.
 */
export function sortTopmostFirst(ids: readonly ObjectId[], source: SceneSource): ObjectId[] {
  const paths = new Map<ObjectId, StackingKey[]>();
  for (const id of ids) {
    const path = stackPathOf(id, source);
    if (path.length > 0) paths.set(id, path);
  }
  return [...paths].sort(([, first], [, second]) => comparePaths(second, first)).map(([id]) => id);
}

/**
 * An object's stacking path, root ancestor first. A missing parent ends it, as at the root, and
 * a parent cycle is cut where it repeats (both are reported by `validateBoard`).
 *
 * @param id - The object id.
 * @param source - The document.
 * @returns The path, or empty when the object is not in the document.
 */
function stackPathOf(id: ObjectId, source: SceneSource): StackingKey[] {
  const path: StackingKey[] = [];
  const visited = new Set<ObjectId>();
  for (
    let object = source.get(id);
    object && !visited.has(object.id);
    object = object.parentId === null ? undefined : source.get(object.parentId)
  ) {
    visited.add(object.id);
    path.unshift({ z: object.z, id: object.id });
  }
  return path;
}

/**
 * Compares two stacking paths; a path that is a prefix of another (an ancestor) is below it.
 *
 * @param first - One path.
 * @param second - Another.
 * @returns Negative when `first` paints below `second`.
 */
function comparePaths(first: readonly StackingKey[], second: readonly StackingKey[]): number {
  for (const [step, a] of first.entries()) {
    const b = second[step];
    if (!b) break;
    const bySibling = compareStacking(a, b);
    if (bySibling !== 0) return bySibling;
  }
  return first.length - second.length;
}

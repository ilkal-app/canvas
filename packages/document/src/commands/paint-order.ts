import { compareSiblings, type Board, type BoardObject, type SiblingKey } from '@canvas/schema';

/**
 * An object's stacking path, root ancestor first: the z key and id of each object from the root
 * down to it. A missing parent ends it, as at the root; a parent cycle is cut where it repeats.
 *
 * @param board - A board holding the object's ancestors.
 * @param object - The object.
 * @returns The path.
 */
function stackPathOf(board: Board, object: BoardObject): SiblingKey[] {
  const path: SiblingKey[] = [];
  const seen = new Set<string>();
  for (
    let current: BoardObject | undefined = object;
    current !== undefined && !seen.has(current.id);
    current = current.parentId === null ? undefined : board.objects.get(current.parentId)
  ) {
    seen.add(current.id);
    path.unshift({ z: current.z, id: current.id });
  }
  return path;
}

/**
 * Compares two objects by where the board paints them, bottom first, whatever their parents:
 * their stacking paths are compared step by step with `compareSiblings`, and an ancestor paints
 * below what it holds. The engine paints by the same rule (`sortTopmostFirst`); keys of objects
 * with different parents are not comparable on their own. Pure.
 *
 * @param board - A board holding both objects' ancestors.
 * @param first - One object.
 * @param second - Another.
 * @returns Negative when `first` paints below `second`, positive when above, 0 for the same
 *   object.
 */
export function comparePaintOrder(board: Board, first: BoardObject, second: BoardObject): number {
  const secondPath = stackPathOf(board, second);
  const firstPath = stackPathOf(board, first);
  for (const [step, key] of firstPath.entries()) {
    const other = secondPath[step];
    if (other === undefined) return 1;
    const order = compareSiblings(key, other);
    if (order !== 0) return order;
  }
  return firstPath.length - secondPath.length;
}

import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';

/**
 * Collects objects and their descendants using a prebuilt child index; see
 * {@link collectDescendants}.
 *
 * @param board - The board holding the objects.
 * @param ids - The objects to start from.
 * @param children - The board's child index.
 * @returns The set of the objects on the board and all their descendants.
 */
export function collectDescendantSet(
  board: Board,
  ids: Iterable<ObjectId>,
  children: ChildIndex,
): Set<ObjectId> {
  const collected = new Set<ObjectId>();
  const pending = [...ids].filter((id) => board.objects.has(id));
  let next = pending.pop();
  while (next !== undefined) {
    if (!collected.has(next)) {
      collected.add(next);
      pending.push(...(children.get(next) ?? []));
    }
    next = pending.pop();
  }
  return collected;
}

/**
 * Collects the given objects and every object below them in the parent tree: the set that
 * deleting them deletes. Ids
 * not on the board are ignored; a parent cycle does not stop the walk from terminating.
 *
 * @param board - The board holding the objects; it is not modified.
 * @param ids - The objects to start from.
 * @returns The ids of those objects and their descendants, sorted by UTF-16 code units.
 */
export function collectDescendants(board: Board, ids: Iterable<ObjectId>): ObjectId[] {
  return [...collectDescendantSet(board, ids, buildChildIndex(board))].sort();
}

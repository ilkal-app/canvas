import type { ObjectId } from '../ids/object-id.js';

import type { Board } from './board.js';

/**
 * The children of every parent: `null` holds the board root's children. The order of each list
 * carries no meaning; stacking order is by `z` and belongs to `@canvas/document`.
 */
export type ChildIndex = ReadonlyMap<ObjectId | null, readonly ObjectId[]>;

/**
 * Indexes a board's objects by parent, in one pass over the board. Objects whose parent is
 * missing are listed under that missing id, so callers can find them.
 *
 * @param board - The board to index.
 * @returns A new index from parent id (or `null` for the root) to child ids.
 */
export function buildChildIndex(board: Board): ChildIndex {
  const children = new Map<ObjectId | null, ObjectId[]>();
  for (const object of board.objects.values()) {
    const siblings = children.get(object.parentId);
    if (siblings === undefined) {
      children.set(object.parentId, [object.id]);
    } else {
      siblings.push(object.id);
    }
  }
  return children;
}

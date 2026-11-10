import { sortedSiblings, type BoardReader } from '@canvas/document';
import { compareSiblings, type ObjectId, type SiblingKey } from '@canvas/schema';

/**
 * Past how many changed children, and what share of the rest, a full sort beats putting each
 * back by binary search (each insertion moves the ids after it).
 */
const MAX_INSERTIONS = 32;

/**
 * A parent's children top first, exactly as `sortedSiblings(board, parentId).reverse()` lists
 * them, from their order before a change: the children that changed (created, deleted, moved
 * in or out, restacked) are taken out, and those that are still children are put back by binary
 * search on their stacking key, ties by id. O(k + c log k) for k children and c changed; a full
 * sort when many changed or when an order key cannot be read.
 *
 * @param board - The document, as of the change.
 * @param parentId - The parent, or null for the board's root.
 * @param previous - Its children before the change, top first.
 * @param changed - Its children that were created, deleted, moved in or out, or restacked.
 * @returns A new array of ids, top first.
 */
export function childOrderAfter(
  board: BoardReader,
  parentId: ObjectId | null,
  previous: readonly ObjectId[],
  changed: ReadonlySet<ObjectId>,
): ObjectId[] {
  const isMany = changed.size > MAX_INSERTIONS && changed.size * 8 > previous.length;
  if (isMany) return sortedSiblings(board, parentId).reverse();
  const order = changed.size === 0 ? [...previous] : previous.filter((id) => !changed.has(id));
  const children = board.references.childrenOf(parentId);
  for (const id of changed) {
    const object = board.get(id);
    if (object === undefined || !children.has(id)) continue;
    const at = insertionIndex(board, order, { id, z: object.z });
    if (at === undefined) return sortedSiblings(board, parentId).reverse();
    order.splice(at, 0, id);
  }
  return order;
}

/**
 * Where a child goes among siblings listed top first: after every sibling stacked above it.
 *
 * @param board - The document.
 * @param order - The siblings, top first.
 * @param child - The child and its key.
 * @returns The index, or undefined when a sibling cannot be read.
 */
function insertionIndex(
  board: BoardReader,
  order: readonly ObjectId[],
  child: SiblingKey,
): number | undefined {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const id = order[middle];
    const sibling = id === undefined ? undefined : board.get(id);
    if (id === undefined || sibling === undefined) return undefined;
    if (compareSiblings({ id, z: sibling.z }, child) > 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

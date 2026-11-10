import {
  collectDescendants,
  createBoard,
  detachConnectorsFrom,
  objectToBoardTransform,
  rootPageIdOf,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { hasListedAncestor } from '../commands/command-checks.js';
import { comparePaintOrder } from '../commands/paint-order.js';
import { generateNKeysBetween } from '../z-order/fractional-key.js';

/**
 * The objects a copy starts from: the selected objects that exist and are not comments (a
 * comment pins a thread that lives outside the document, so a copy of the pin would share the
 * thread), minus those inside another selected object, which come with it.
 *
 * @param board - The board.
 * @param ids - The selected ids.
 * @returns The roots of the copy, in paint order, bottom first.
 */
function copyRoots(board: Board, ids: readonly ObjectId[]): BoardObject[] {
  return unorderedRoots(board, ids).sort((first, second) =>
    comparePaintOrder(board, first, second),
  );
}

/**
 * The roots of a copy ({@link copyRoots}) in selection order.
 *
 * @param board - The board.
 * @param ids - The selected ids.
 * @returns The roots.
 */
function unorderedRoots(board: Board, ids: readonly ObjectId[]): BoardObject[] {
  const selected = new Set(ids);
  const reader = { get: (id: ObjectId) => board.objects.get(id) };
  return ids
    .flatMap((id) => board.objects.get(id) ?? [])
    .filter((object) => object.type !== 'comment' && !hasListedAncestor(reader, object, selected));
}

/**
 * The ids a copy takes: its roots and all their descendants, comments left out, each once.
 *
 * @param board - The board.
 * @param roots - The copy's roots.
 * @returns The ids.
 */
function copiedIdsOf(board: Board, roots: readonly BoardObject[]): Set<ObjectId> {
  return new Set(
    collectDescendants(
      board,
      roots.map(({ id }) => id),
    ).filter((id) => board.objects.get(id)?.type !== 'comment'),
  );
}

/**
 * How many objects {@link copySelection} would copy, counted from ids alone, without
 * materializing anything (a duplicate past its limit is refused before it is copied).
 *
 * @param board - The board the selection is on.
 * @param ids - The selected ids; unknown ids are ignored.
 * @returns The count; 0 when nothing selected can be copied.
 */
export function countCopied(board: Board, ids: readonly ObjectId[]): number {
  const roots = unorderedRoots(board, ids);
  return roots.length === 0 ? 0 : copiedIdsOf(board, roots).size;
}

/**
 * The ids of objects outside the copy that its connectors are attached to.
 *
 * @param objects - The copied objects.
 * @param copied - Their ids.
 * @returns The outside targets.
 */
function outsideTargets(
  objects: readonly BoardObject[],
  copied: ReadonlySet<ObjectId>,
): ObjectId[] {
  return objects.flatMap((object) =>
    object.type === 'connector'
      ? [object.from, object.to].flatMap((end) =>
          end.kind === 'object' && !copied.has(end.objectId) ? [end.objectId] : [],
        )
      : [],
  );
}

/**
 * An object's root ancestor: the object itself at the root, else the topmost parent its chain
 * reaches (a broken or looping chain stops where it breaks).
 *
 * @param board - The board.
 * @param object - The object.
 * @returns Its root ancestor.
 */
function rootAncestorOf(board: Board, object: BoardObject): BoardObject {
  const walked = new Set<ObjectId>([object.id]);
  let current = object;
  while (current.parentId !== null) {
    const parent = board.objects.get(current.parentId);
    if (parent === undefined || walked.has(parent.id)) break;
    walked.add(parent.id);
    current = parent;
  }
  return current;
}

/**
 * The board a copy puts on the clipboard: the
 * selected objects with all their descendants, as a board of its own that `importBoard` accepts.
 * Each copied root moves to the board root at its place on the board (its placement composed
 * with its old parents', on its root ancestor's page), stacked in the order the board painted the roots, with fresh keys; its
 * descendants keep their own fields. A connector end on an object that is not copied becomes a
 * free point where that end was (the schema's `detachConnectorsFrom`). Comments are not copied.
 * Images and videos keep their `assetId`: assets are referenced, never duplicated. Texts keep
 * their runs. Pure: the board is not modified.
 *
 * @param board - The board the selection is on.
 * @param ids - The selected ids; unknown ids are ignored.
 * @returns The copy, or `undefined` when nothing selected can be copied.
 */
export function copySelection(board: Board, ids: readonly ObjectId[]): Board | undefined {
  const roots = copyRoots(board, ids);
  if (roots.length === 0) return undefined;
  const copied = copiedIdsOf(board, roots);
  const objects = [...copied].flatMap((id) => board.objects.get(id) ?? []);
  const targets = outsideTargets(objects, copied);
  const detached = targets.length > 0 ? detachConnectorsFrom(board, targets) : board;
  const rootKeys = generateNKeysBetween(null, null, roots.length);
  const rebased = new Map(
    roots.map((root, index) => {
      const transform = objectToBoardTransform(board, root);
      const placement =
        root.parentId === null
          ? {}
          : {
              x: transform.x,
              y: transform.y,
              rotation: Math.atan2(transform.sin, transform.cos),
              // A root names its page; a child was on its root ancestor's.
              pageId: rootPageIdOf(rootAncestorOf(board, root)),
            };
      return [root.id, { ...placement, parentId: null, z: rootKeys[index] ?? root.z }] as const;
    }),
  );
  return createBoard(
    objects.map((object) => {
      const current = detached.objects.get(object.id) ?? object;
      const root = rebased.get(object.id);
      return root === undefined ? current : { ...current, ...root };
    }),
  );
}

import type { Board, BoardObject, ObjectId } from '@canvas/schema';

import { MAX_OBJECTS_PER_TRANSACTION, orderByReferences } from './create-objects-parts.js';
import { DELETE_WRITES, OBJECT_WRITES, packByWrites } from './write-budget.js';

/** What `deleteObjects` writes: the ids it deletes, and the objects it rewrites. */
interface DeletedObjects {
  /** The ids deleted. */
  readonly deletedIds: readonly ObjectId[];
  /** The objects rewritten: connectors detached, comments unpinned. */
  readonly updated: readonly BoardObject[];
}

/**
 * Orders the ids a delete removes referrers first: children before their parents, a
 * connector or a comment before what it is attached to; otherwise as given. The reverse of
 * `orderByReferences`, so an undo, which re-creates the last part first, re-creates referents
 * before referrers.
 *
 * @param board - A board holding every object deleted.
 * @param ids - The ids deleted.
 * @returns The same ids, referrers first.
 */
export function referrersFirst(board: Board, ids: readonly ObjectId[]): ObjectId[] {
  const objects = ids.flatMap((id) => board.objects.get(id) ?? []);
  const listed = new Set(objects.map((object) => object.id));
  const ordered = orderByReferences(objects)
    .reverse()
    .map((object) => object.id);
  return [...ordered, ...ids.filter((id) => !listed.has(id))];
}

/**
 * Splits what `deleteObjects` writes into transactions so each part leaves the board
 * valid. Without a write budget, at most `maxObjects` deletions per transaction: the first also
 * rewrites the detached connectors and unpinned comments, so no object on the board refers to one
 * a later part deletes, and the ids go in the order given (referrers first, `referrersFirst`). An
 * undo of the step re-creates one part per transaction, the last first: referents before
 * referrers, each transaction under the collab client's chunk size for typical objects.
 *
 * @param plan - The ids to delete, referrers first, and the objects to rewrite.
 * @param maxObjects - The most deletions per transaction; default
 *   `MAX_OBJECTS_PER_TRANSACTION`.
 * @returns The parts and the command's result, or `undefined` when the plan fits one
 *   transaction.
 */
export function splitDeletedObjects(
  plan: DeletedObjects,
  maxObjects = MAX_OBJECTS_PER_TRANSACTION,
):
  | {
      readonly parts: DeletedObjects[];
      readonly result: {
        readonly deletedIds: readonly ObjectId[];
        readonly updatedIds: ObjectId[];
      };
    }
  | undefined {
  if (plan.deletedIds.length <= maxObjects) return undefined;
  const parts: DeletedObjects[] = [];
  for (let start = 0; start < plan.deletedIds.length; start += maxObjects) {
    const deletedIds = plan.deletedIds.slice(start, start + maxObjects);
    parts.push({ deletedIds, updated: start === 0 ? plan.updated : [] });
  }
  const updatedIds = plan.updated.map((object) => object.id);
  return { parts, result: { deletedIds: plan.deletedIds, updatedIds } };
}

/** One write of a budgeted deletion: an object rewritten whole, or an id deleted. */
type DeletionWrite =
  | { readonly kind: 'rewrite'; readonly object: BoardObject }
  | { readonly kind: 'delete'; readonly id: ObjectId };

/**
 * Splits a deletion into parts of at most `maxWrites` planned writes: every
 * rewrite first (the detached connectors, the unpinned comments, a retired main's materialized
 * definitions, referents before referrers), then the deletions referrers first. So no rewrite
 * comes after the deletion it answers, whichever part that falls in, and every part leaves the
 * board valid: a connector detached, or a comment re-pinned, while its target still stands is
 * valid, and so is a definition materialized before its main is retired. Each rewrite is written
 * once. An undo re-creates the deletions first, referents first, then restores the rewrites.
 *
 * @param plan - What the deletion writes; `splitOrder`, when present, the deletions referrers
 *   first.
 * @param maxWrites - The budget per part.
 * @param lastReserve - Writes the last part carries besides its own (a page it deletes).
 * @returns The parts, or `undefined` when the plan fits one part.
 */
export function splitDeletionByWrites(
  plan: DeletedObjects & { readonly splitOrder?: readonly ObjectId[] },
  maxWrites: number,
  lastReserve = 0,
): DeletedObjects[] | undefined {
  const total =
    plan.updated.length * OBJECT_WRITES + plan.deletedIds.length * DELETE_WRITES + lastReserve;
  if (total <= maxWrites) return undefined;
  const writes: DeletionWrite[] = [
    ...orderByReferences(plan.updated).map((object) => ({ kind: 'rewrite' as const, object })),
    ...(plan.splitOrder ?? plan.deletedIds).map((id) => ({ kind: 'delete' as const, id })),
  ];
  const parts = packByWrites(
    writes,
    (write) => (write.kind === 'rewrite' ? OBJECT_WRITES : DELETE_WRITES),
    maxWrites,
    { last: lastReserve },
  );
  if (parts.length < 2) return undefined;
  return parts.map((part) => ({
    updated: part.flatMap((write) => (write.kind === 'rewrite' ? [write.object] : [])),
    deletedIds: part.flatMap((write) => (write.kind === 'delete' ? [write.id] : [])),
  }));
}

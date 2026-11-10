import { z } from 'zod';

import {
  cascadeDelete,
  objectIdSchema,
  type BoardObject,
  type ConnectorDeletePolicy,
  type ObjectId,
  detachedComments,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { splitComponentDeletion } from './component-command-parts.js';
import { MAX_OBJECTS_PER_TRANSACTION } from './create-objects-parts.js';
import { referrersFirst } from './delete-objects-parts.js';
import { planComponentRetirement } from './retire-components.js';
import { SubBoard } from './sub-board.js';
import { unlessParentCycle } from './world-frame.js';

/** Validates the input of {@link deleteObjectsCommand}. */
export const deleteObjectsInputSchema = z
  .strictObject({
    /** The objects to delete; their descendants go with them. */
    ids: z
      .array(objectIdSchema)
      .min(1)
      .describe('The objects to delete; their descendants go with them.'),
    /** What happens to connectors attached to deleted objects: detach (default) or delete. */
    connectorPolicy: z
      .enum(['detach', 'delete'] satisfies ConnectorDeletePolicy[])
      .default('detach')
      .describe(
        'What happens to connectors attached to deleted objects: detach (default) or delete.',
      ),
  })
  .describe('Deletes objects with their descendants, detaching or deleting attached connectors.');

/** What {@link deleteObjectsCommand} returns. */
export interface DeleteObjectsResult {
  /** Main definitions retained after this deletion, when components were involved. */
  readonly retiredIds?: readonly ObjectId[];
  /** Instances converted into frames, when components were involved. */
  readonly detachedIds?: readonly ObjectId[];
  /**
   * The detached instances' new children, by new id, to the main child each copies, when
   * components were involved (`detachInstance`'s `idMap`, keyed the other way, since
   * several instances detach at once).
   */
  readonly copiedFrom?: Readonly<Record<ObjectId, ObjectId>>;
  /** Every object deleted, descendants and policy-deleted connectors included, sorted. */
  readonly deletedIds: readonly ObjectId[];
  /** Every surviving object changed (detached connectors, re-anchored comments), sorted. */
  readonly updatedIds: readonly ObjectId[];
}

/** What {@link deleteObjectsCommand} will write. */
export interface DeleteObjectsPlan {
  /** Main definitions retained after this deletion. */
  readonly retiredIds?: readonly ObjectId[];
  /** Instances converted into frames. */
  readonly detachedIds?: readonly ObjectId[];
  /** The detached instances' new children, by new id, to the main child each copies. */
  readonly copiedFrom?: Readonly<Record<ObjectId, ObjectId>>;
  /** The objects to delete, sorted. */
  readonly deletedIds: readonly ObjectId[];
  /** The detached connectors and re-anchored comments, sorted by id. */
  readonly updated: readonly BoardObject[];
  /**
   * The deleted ids referrers first, when `deletedIds` keeps another order (a deletion of up to
   * `MAX_OBJECTS_PER_TRANSACTION`): the order a write-budgeted split deletes in, so a part never
   * deletes an object a later part's object still refers to.
   */
  readonly splitOrder?: readonly ObjectId[];
}

/**
 * Gathers what the schema's `cascadeDelete` reads when deleting `ids`, through the reverse
 * indexes: the subtrees being deleted, the connectors attached to anything in them and the
 * comments pinned to either, the chains of ancestors that place them all on the board, and the
 * targets of those connectors' other ends, which an automatic anchor measures its side from.
 *
 * @param board - The board before the command.
 * @param ids - The objects to delete.
 * @returns The sub-board.
 */
function gatherCascade(board: BoardReader, ids: readonly ObjectId[]): SubBoard {
  const subBoard = new SubBoard(board);
  const { references } = board;
  const subtree = ids.flatMap((id) => subBoard.addSubtree(id));
  const attached = subtree.flatMap((id) => [...references.connectorsAttachedTo(id)]);
  const pinned = [...subtree, ...attached].flatMap((id) => [...references.commentsAnchoredTo(id)]);
  for (const id of [...ids, ...attached, ...pinned]) subBoard.addWithAncestors(id);
  for (const id of attached) subBoard.addConnectorTargets(subBoard.lookUp(id));
  return subBoard;
}

/**
 * `deleteObjects`: deletes objects and, recursively, their children;
 * connectors attached to a deleted object are detached (the end becomes a free point where it
 * was) or, under the `delete` policy, deleted; comments pinned to a deleted object become point
 * pins where they were. The rules are the schema's `cascadeDelete`, run on the objects the
 * reverse indexes lead to rather than on the whole board, so the cost follows the size of the
 * deletion. Everything happens in one transaction, so one undo restores it all; past
 * `MAX_OBJECTS_PER_TRANSACTION` (1,000) deletions, in transactions of at most that many,
 * referrers first, the detaching in the first, still one undo step whose undo re-creates the
 * objects one part per transaction, referents first (each under the collab client's
 * chunk size for typical objects, so a peer never sees part of a transaction).
 */
export const deleteObjectsCommand: Command<
  typeof deleteObjectsInputSchema,
  DeleteObjectsPlan,
  DeleteObjectsResult
> = {
  name: 'deleteObjects',
  isPlacePreserving: true,
  description:
    'Deletes objects with their descendants; attached connectors are detached or deleted.',
  input: deleteObjectsInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    if (errors.length > 0) return reject(errors);
    const ids = named.map(({ object }) => object.id);
    const cascade = unlessParentCycle(() => {
      const board = gatherCascade(context.board, ids).toBoard();
      const retirement = planComponentRetirement(context, board, ids, errors);
      return {
        board,
        retirement,
        result: cascadeDelete(retirement.board, retirement.ids, {
          connectorPolicy: input.connectorPolicy,
        }),
      };
    });
    if (cascade === null) {
      const message = 'a detached connector end or comment pin sits below a parent cycle';
      return reject([commandError('parent-cycle', null, ['ids'], message)]);
    }
    if (errors.length > 0) return reject(errors);
    const { result, retirement } = cascade;
    const updatedIds = new Set(result.updatedIds);
    const checkErrors: CommandError[] = [];
    const updated = [...result.board.objects.values()]
      .filter((object) => updatedIds.has(object.id))
      .flatMap((object) => checkObject(context.board, object, checkErrors) ?? [])
      .sort((first, second) => (first.id < second.id ? -1 : 1));
    // A retired main keeps its content, which the cascade does not see (`planComponentRetirement`
    // drops it from its board): a comment in that content pinned to a deleted object is
    // re-pinned to a point here, as the cascade does for every other comment.
    const retainedPins = detachedComments(cascade.board, new Set(result.deletedIds)).filter(
      (comment) => !retirement.board.objects.has(comment.id) && !updatedIds.has(comment.id),
    );
    for (const comment of retainedPins) {
      const checked = checkObject(context.board, comment, checkErrors);
      if (checked !== undefined) updated.push(checked);
    }
    // The retirement's writes are judged like the cascade's: a retired main goes onto the root
    // where its ancestors placed it, and an ancestor a peer left at an infinite place puts it at
    // one, which would throw inside the transaction.
    for (const object of retirement.updated) {
      const checked = checkObject(context.board, object, checkErrors);
      if (checked !== undefined) updated.push(checked);
    }
    if (checkErrors.length > 0) return reject(checkErrors);
    // Past one transaction's worth, referrers first, so each part leaves the board valid; a
    // smaller deletion keeps its order and carries the referrers-first one for a split at a
    // smaller write budget.
    const isLarge = result.deletedIds.length > MAX_OBJECTS_PER_TRANSACTION;
    const deletedIds = isLarge
      ? referrersFirst(cascade.board, result.deletedIds)
      : result.deletedIds;
    const split =
      !isLarge && deletedIds.length > 1
        ? { splitOrder: referrersFirst(cascade.board, deletedIds) }
        : {};
    return accept(
      retirement.retiredIds.length === 0
        ? { deletedIds, updated, ...split }
        : {
            deletedIds,
            updated,
            ...split,
            retiredIds: retirement.retiredIds,
            detachedIds: retirement.detachedIds,
            copiedFrom: retirement.copiedFrom,
          },
    );
  },
  apply(transaction, input, plan) {
    for (const id of plan.deletedIds) transaction.deleteObject(id);
    for (const object of plan.updated) transaction.setObject(object);
    const result = {
      deletedIds: plan.deletedIds,
      updatedIds: plan.updated.map((object) => object.id),
    };
    return plan.retiredIds === undefined
      ? result
      : {
          ...result,
          retiredIds: plan.retiredIds,
          detachedIds: plan.detachedIds ?? [],
          copiedFrom: plan.copiedFrom ?? {},
        };
  },
  split: splitComponentDeletion,
};

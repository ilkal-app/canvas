import type { BoardObject } from '@canvas/schema';

import type { CommandParts, SplitOptions } from './command.js';
import { MAX_OBJECTS_PER_TRANSACTION, orderByReferences } from './create-objects-parts.js';
import { splitDeletedObjects, splitDeletionByWrites } from './delete-objects-parts.js';
import type { DeleteObjectsPlan, DeleteObjectsResult } from './delete-objects.js';
import type { DetachInstancePlan, DetachInstanceResult } from './detach-instance.js';
import { OBJECT_WRITES, packByWrites } from './write-budget.js';

/**
 * Splits a large detach into parent-before-child batches within one undo group. Every part names
 * the frame, which only the first writes (it is no longer an instance after), so the first part's
 * budget keeps room for it: one object less without a write budget, and its two planned writes
 * with one.
 *
 * @param plan - Validated frame and materialized descendants.
 * @param options - The write budget per part, if any.
 * @returns Parts, or undefined when one transaction suffices.
 */
export function splitInstanceDetach(
  plan: DetachInstancePlan,
  options: SplitOptions = {},
): CommandParts<DetachInstancePlan, DetachInstanceResult> | undefined {
  const { maxWrites } = options;
  const parts: DetachInstancePlan[] = [];
  const partOf = (children: BoardObject[]): DetachInstancePlan => ({
    frame: plan.frame,
    children,
    idMap: {},
    clamped: [],
  });
  if (maxWrites === undefined) {
    if (plan.children.length < MAX_OBJECTS_PER_TRANSACTION) return undefined;
    const children = orderByReferences(plan.children);
    const size = MAX_OBJECTS_PER_TRANSACTION - 1;
    for (let start = 0; start < children.length; start += size) {
      parts.push(partOf(children.slice(start, start + size)));
    }
  } else {
    if ((plan.children.length + 1) * OBJECT_WRITES <= maxWrites) return undefined;
    const packed = packByWrites(orderByReferences(plan.children), () => OBJECT_WRITES, maxWrites, {
      first: OBJECT_WRITES,
    });
    for (const children of packed) parts.push(partOf(children));
  }
  return {
    parts,
    result: {
      frameId: plan.frame.id,
      createdIds: plan.children.map(({ id }) => id),
      idMap: plan.idMap,
      clamped: plan.clamped,
    },
  };
}

/**
 * Splits component materializations before deletions, preserving retained definitions throughout.
 * Ordinary deletions keep the established splitting behavior and result shape. With a write
 * budget, every rewrite and materialization first, then the deletions referrers first,
 * in parts of at most `maxWrites` planned writes (`splitDeletionByWrites`).
 *
 * @param plan - Validated deletion and retirement writes.
 * @param options - The write budget per part, if any.
 * @param lastReserve - Writes the last part carries besides its own (a page it deletes); with a
 *   budget only.
 * @returns Bounded parts and the complete result, or undefined for a single transaction.
 */
export function splitComponentDeletion(
  plan: DeleteObjectsPlan,
  options: SplitOptions = {},
  lastReserve = 0,
): CommandParts<DeleteObjectsPlan, DeleteObjectsResult> | undefined {
  if (options.maxWrites !== undefined) {
    const parts = splitDeletionByWrites(plan, options.maxWrites, lastReserve);
    if (parts === undefined) return undefined;
    const result = {
      deletedIds: plan.deletedIds,
      updatedIds: plan.updated.map(({ id }) => id),
    };
    return {
      parts,
      result:
        plan.retiredIds === undefined
          ? result
          : {
              ...result,
              retiredIds: plan.retiredIds,
              detachedIds: plan.detachedIds ?? [],
              copiedFrom: plan.copiedFrom ?? {},
            },
    };
  }
  if (plan.retiredIds === undefined) return splitDeletedObjects(plan);
  const size = MAX_OBJECTS_PER_TRANSACTION;
  if (plan.updated.length + plan.deletedIds.length <= size) return undefined;
  const updated = orderByReferences(plan.updated);
  const parts: DeleteObjectsPlan[] = [];
  for (let start = 0; start < updated.length; start += size)
    parts.push({ updated: updated.slice(start, start + size), deletedIds: [] });
  for (let start = 0; start < plan.deletedIds.length; start += size)
    parts.push({ updated: [], deletedIds: plan.deletedIds.slice(start, start + size) });
  return {
    parts,
    result: {
      deletedIds: plan.deletedIds,
      updatedIds: plan.updated.map(({ id }) => id),
      retiredIds: plan.retiredIds,
      detachedIds: plan.detachedIds ?? [],
      copiedFrom: plan.copiedFrom ?? {},
    },
  };
}

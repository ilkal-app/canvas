import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import type { UndoStep } from './field-guard.js';

/**
 * The objects a step would remove: live entries of the objects map among its insertions, or the
 * entries an undo or redo has since re-created them as (Yjs follows `item.redone`, and so does
 * this). Cost: one pass over the step's inserted structs.
 *
 * @param transaction - The open transaction the step will be applied in.
 * @param step - The step.
 * @param objects - The document's objects map.
 * @returns Each removed object's current entry, by id.
 */
export function removedEntries(
  transaction: Y.Transaction,
  step: UndoStep,
  objects: Y.Map<unknown>,
): Map<ObjectId, Y.Item> {
  const removed = new Map<ObjectId, Y.Item>();
  Y.iterateDeletedStructs(transaction, step.insertions, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parent !== objects) return;
    let entry = struct;
    while (entry.redone !== null) {
      const next = Y.getItem(transaction.doc.store, entry.redone);
      if (!(next instanceof Y.Item)) return;
      entry = next;
    }
    if (!entry.deleted && entry.parentSub !== null) {
      removed.set(entry.parentSub as ObjectId, entry);
    }
  });
  return removed;
}

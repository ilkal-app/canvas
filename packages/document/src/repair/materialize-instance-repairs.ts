import type { BoardObject, ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import type { DocumentStore } from '../store/document-store.js';

/**
 * Materializes reader-projected component repairs with placement-only system writes.
 *
 * @param store - Writable human client's document.
 * @param written - Identities already repaired by the ordinary repair pass.
 * @param roots - Projected instance roots, empty for agents and read-only clients.
 * @returns Every repaired identity, sorted and unique.
 */
export function materializeInstanceRepairs(
  store: DocumentStore,
  written: readonly ObjectId[],
  roots: readonly BoardObject[],
): ObjectId[] {
  if (roots.length > 0)
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of roots)
        transaction.patchObject(object.id, {
          parentId: object.parentId,
          pageId: object.pageId,
          x: object.x,
          y: object.y,
          rotation: object.rotation,
        });
    });
  return [...new Set([...written, ...roots.map(({ id }) => id)])].sort();
}

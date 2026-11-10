import type { ObjectId } from '@canvas/schema';

import { isObjectWrittenByOthers, mapOf, type WriterScope } from '../history/written-by-others.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';

/** Every client's whole history: a write by any client but the creator's counts. */
const NO_PAST = { state: new Map<number, number>(), clientId: -1 };

/**
 * The objects among `ids` that someone other than their creator has written to since they were
 * created (Lift off; the rule of `history/written-by-others.ts`): an object
 * counts when a Yjs client other than the one that put its entry on the board wrote any key of
 * it (a reference key only together with its `updatedAt`, so the reference repair's own writes
 * never count), or anything inside its texts, label or network. The creator's client is the
 * agent's when an agent created the object, so this tells the agent's work from what a person,
 * on this device or another, did to it since; a write made after the creating client
 * reconnected under a new client id counts too, which keeps an object rather than loses one.
 * Ids not on the board are left out. Cost: one pass over each object's items. Main thread.
 *
 * @param store - A Yjs document store (`YjsDocumentStore`).
 * @param ids - The objects to look at.
 * @returns The ids written to by others, in the order given.
 * @throws {TypeError} When the store is not a Yjs document store.
 */
export function writtenSinceCreation(store: DocumentStore, ids: readonly ObjectId[]): ObjectId[] {
  const { doc, objects } = internalsOf(store);
  return ids.filter((id) => {
    const entry = objects._map.get(id);
    if (entry === undefined || entry.deleted) return false;
    const map = mapOf(entry);
    if (map === null) return false;
    const scope: WriterScope = {
      past: NO_PAST,
      ownIds: new Set([entry.id.client]),
      store: doc.store,
    };
    return isObjectWrittenByOthers(map, scope, true);
  });
}

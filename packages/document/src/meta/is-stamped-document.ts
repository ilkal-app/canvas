import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';

import { DOCUMENT_META_KEY, META_MAP_NAME } from './document-meta.js';

/**
 * Tells whether a board's document carries a metadata stamp: whether any store has
 * written to it, or received a writer's updates, since documents were stamped. Every store stamps
 * the document before its first write and the stamp is never removed, so a board whose objects
 * were all deleted is still stamped, while a board nobody ever wrote to is not. The app seeds only
 * an unstamped, empty board (`openBoardConnection`).
 *
 * @param store - A `YjsDocumentStore`.
 * @returns Whether the document holds metadata.
 * @throws {TypeError} When the store is not a `YjsDocumentStore`.
 */
export function isStampedDocument(store: DocumentStore): boolean {
  // Any item under the key counts, deleted or not: concurrent stamps from several writers merge
  // to one, and a reader can briefly hold only a deleted one (see `document-version-guard.ts`).
  return internalsOf(store).doc.getMap<unknown>(META_MAP_NAME)._map.has(DOCUMENT_META_KEY);
}

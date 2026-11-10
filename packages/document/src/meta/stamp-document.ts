import type * as Y from 'yjs';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from './document-meta.js';

/**
 * Writes this build's metadata (schema and layout version) into a board's `Y.Doc`, as every
 * `YjsDocumentStore` does right before its first write. A writer that creates object
 * entries through raw Yjs, such as a relay migration or an import tool, calls it in the same
 * transaction before its first object, so its stamp precedes its objects in its Yjs client's
 * clock order; stores refuse objects whose writer never stamped (`DocumentVersionError`). Call it
 * again after the document's client id changes, since the check is per client id.
 *
 * @param doc - The board's document; written in its current transaction, or its own.
 */
export function stampDocument(doc: Y.Doc): void {
  doc.getMap<unknown>(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
}

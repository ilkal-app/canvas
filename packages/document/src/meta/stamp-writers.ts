import * as Y from 'yjs';

import { DOCUMENT_META_KEY } from './document-meta.js';

/**
 * Adds every writer that ever stamped a document to a set: the Yjs client id of each
 * item in the metadata key's item chain, deleted or not. Every writer stamps the same key and
 * Yjs keeps one of concurrent stamps, deleting the others where they merge, so a deleted stamp
 * still shows its writer stamped. Package-internal: the store's version guard and the relay's
 * update check (`UpdateStampCheck`) both read the chain this way.
 *
 * @param meta - The document's top-level metadata map.
 * @param writers - The set to add the writers to; changed in place.
 */
export function addStampWriters(meta: Y.Map<unknown>, writers: Set<number>): void {
  for (let item = meta._map.get(DOCUMENT_META_KEY) ?? null; item !== null; item = item.left) {
    if (item instanceof Y.Item) writers.add(item.id.client);
  }
}

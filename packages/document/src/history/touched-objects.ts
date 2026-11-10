import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { topLevelKeyOf } from '../store/change-collector.js';

/**
 * The objects a Yjs transaction has changed so far: keys added to, replaced in or removed from
 * the objects map, and the objects any changed nested type (a field map, a text, a network)
 * belongs to. Read while the transaction is still open, which is when the undo history repairs
 * what its step left behind.
 *
 * @param transaction - The open transaction.
 * @param objects - The document's top-level objects map.
 * @returns The ids, in no particular order.
 */
export function touchedObjectIds(
  transaction: Y.Transaction,
  objects: Y.Map<unknown>,
): Set<ObjectId> {
  const ids = new Set<string>();
  for (const [changed, keys] of transaction.changed) {
    const type = changed as Y.AbstractType<unknown>;
    if (type === objects) {
      for (const key of keys) if (key !== null) ids.add(key);
      continue;
    }
    const key = topLevelKeyOf(type, objects);
    if (key !== null) ids.add(key);
  }
  return ids as Set<ObjectId>;
}

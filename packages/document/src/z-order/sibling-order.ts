import { compareSiblings, type ObjectId, type SiblingKey } from '@canvas/schema';

import type { DocumentStore } from '../store/document-store.js';

import { generateObjectKeys } from './object-keys.js';

/**
 * What the z-order helpers read: objects one at a time and the reverse indexes, as of the last
 * completed transaction (the same view as the command layer's `BoardReader`).
 */
export type SiblingReader = Pick<DocumentStore, 'get' | 'references'>;

/**
 * The children of a parent with their keys, in no order, as of the store's last completed
 * transaction. Children that cannot be read are left out.
 *
 * @param store - The document.
 * @param parentId - A group or frame id, or `null` for the board root.
 * @returns A new array.
 */
export function readSiblingKeys(store: SiblingReader, parentId: ObjectId | null): SiblingKey[] {
  const siblings: SiblingKey[] = [];
  for (const id of store.references.childrenOf(parentId)) {
    const object = store.get(id);
    if (object !== undefined) siblings.push({ id, z: object.z });
  }
  return siblings;
}

/**
 * The children of a parent in stacking order, bottom (drawn first) to top, as of the store's
 * last completed transaction: by `z`, ties broken by id. For the layers panel and the scene
 * graph's segments. O(n log n) in the number of siblings.
 *
 * @param store - The document.
 * @param parentId - A group or frame id, or `null` for the board root.
 * @returns A new array of ids; empty when the parent has no readable children.
 */
export function sortedSiblings(
  store: Pick<DocumentStore, 'get' | 'references'>,
  parentId: ObjectId | null,
): ObjectId[] {
  return readSiblingKeys(store, parentId)
    .sort(compareSiblings)
    .map((sibling) => sibling.id);
}

/**
 * Keys that stack new objects above every current child of a parent, in the order given: the
 * keys a create, connect or paste command gives the objects it adds. The top child comes from
 * the store's `topChildOf`: O(1) while the top only rises, one rescan of the parent after the
 * top child moves down or away. Call it once for all the objects a command adds, because the
 * store does not see a transaction's own writes until it ends. Commands go through
 * `nextZAbove`, which turns an unusable top key into a command error instead of this throw.
 *
 * @param store - The document, as of its last completed transaction.
 * @param parentId - The parent the objects will have, or `null` for the board root.
 * @param ids - The new objects, bottom first.
 * @returns One key per id.
 * @throws {RangeError} When the top sibling's key is not a fractional-index key.
 */
export function keysAtFront(
  store: Pick<DocumentStore, 'get' | 'references'>,
  parentId: ObjectId | null,
  ids: readonly ObjectId[],
): string[] {
  const top = store.references.topChildOf(parentId);
  const topKey = top === undefined ? undefined : store.get(top)?.z;
  return generateObjectKeys(topKey ?? null, null, ids);
}

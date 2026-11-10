import type * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import type { RepairView } from '../repair/reference-repair.js';

import type { ObjectCache } from './object-cache.js';
import type { BoardReferences } from './reference-index.js';

// The read-only views a store hands out over its decoded cache, so callers never reach the cache
// itself: the reverse indexes (`references`) and the board now as the reference repair reads it.

/**
 * The read-only view of a cache's reverse indexes.
 *
 * @param cache - The cache.
 * @returns The view, frozen.
 */
export function referencesView(cache: ObjectCache): BoardReferences {
  return Object.freeze({
    childrenOf: (parentId: ObjectId | null) => cache.childrenOf(parentId),
    topChildOf: (parentId: ObjectId | null) => cache.topChildOf(parentId),
    connectorsAttachedTo: (objectId: ObjectId) => cache.connectorsAttachedTo(objectId),
    instancesOf: (mainId: ObjectId) => cache.instancesOf(mainId),
    commentsAnchoredTo: (objectId: ObjectId) => cache.commentsAnchoredTo(objectId),
  });
}

/**
 * The board now, as the reference repair reads it: the cache's objects, and whether the object
 * map has an entry, readable or not.
 *
 * @param cache - The cache.
 * @param objects - The object map.
 * @returns The view, frozen.
 */
export function repairView(cache: ObjectCache, objects: Y.Map<unknown>): RepairView {
  return Object.freeze({
    get: (id: ObjectId) => cache.get(id),
    isPresent: (id: ObjectId) => objects.has(id),
  });
}

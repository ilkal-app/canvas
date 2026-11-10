import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SceneChangeSet, SceneSource } from '../scene/scene-source.js';

/**
 * Adds an object and its ancestors to `found`, walking parent ids through `source` until the
 * board, a missing parent or an object already found (which also ends a parent cycle).
 *
 * @param object - The object.
 * @param source - The document to read ancestors from.
 * @param found - The objects gathered so far, by id; extended in place.
 */
function gatherWithAncestors(
  object: BoardObject,
  source: SceneSource,
  found: Map<ObjectId, BoardObject>,
): void {
  let current: BoardObject | undefined = object;
  while (current !== undefined && !found.has(current.id)) {
    found.set(current.id, current);
    current = current.parentId === null ? undefined : source.get(current.parentId);
  }
}

/**
 * Collects each changed object and ancestor once, before choosing a transport representation.
 *
 * @param changes - Current immutable scene changes.
 * @returns A new map owned by the encoder.
 */
export function changeSetObjects(changes: SceneChangeSet): Map<ObjectId, BoardObject> {
  const found = new Map<ObjectId, BoardObject>();
  for (const ids of [changes.created, changes.updated, changes.deleted]) {
    for (const id of ids) {
      const object = changes.get(id);
      if (object !== undefined) gatherWithAncestors(object, changes, found);
    }
  }
  return found;
}

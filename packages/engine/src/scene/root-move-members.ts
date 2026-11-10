import type { BoardObject, ObjectId } from '@canvas/schema';

import { isRootMoveChanges } from './root-move-changes.js';
import type { SceneChangeSet } from './scene-source.js';

/**
 * Preflights every scoped member before a retained scene writes any target. The installer
 * guarantees unique ordered ids and an immutable snapshot in the engine-owned environment.
 *
 * @param changes - The update whose snapshot is scoped over synchronous collection.
 * @param objects - Its ordered objects.
 * @param hierarchy - The current applied hierarchy, including actual malformed leaf children.
 * @param hierarchy.isRootLeaf - Checks existence, root parent and absence of actual children.
 * @returns Whether all members can skip unchanged parent links and descendant traversal.
 */
export function canApplyRootMove(
  changes: SceneChangeSet,
  objects: readonly BoardObject[],
  hierarchy: { isRootLeaf(id: ObjectId): boolean },
): boolean {
  if (
    !isRootMoveChanges(changes) ||
    changes.created.length > 0 ||
    changes.deleted.length > 0 ||
    objects.length !== changes.updated.length
  )
    return false;
  for (let index = 0; index < objects.length; index++) {
    const object = objects[index];
    if (
      object === undefined ||
      object.id !== changes.updated[index] ||
      object.parentId !== null ||
      object.type === 'frame' ||
      object.type === 'group' ||
      !hierarchy.isRootLeaf(object.id)
    )
      return false;
  }
  return true;
}

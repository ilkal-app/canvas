import { isFrameNameShown, type BoardObject, type ObjectId } from '@canvas/schema';

import { isRootMoveChanges } from './root-move-changes.js';
import type { SceneHierarchy } from './scene-hierarchy.js';
import type { SceneChangeSet } from './scene-source.js';

/**
 * Adds to `added` every frame without a stored `showName` below an object, in the scene's
 * hierarchy, that the change set does not list.
 *
 * @param root - The object whose subtree is walked.
 * @param hierarchy - The scene's hierarchy, as last applied.
 * @param changes - The change set, to read the descendants.
 * @param listed - The ids the change set lists.
 * @param added - Where the frames go.
 */
function collectFrames(
  root: ObjectId,
  hierarchy: SceneHierarchy,
  changes: SceneChangeSet,
  listed: ReadonlySet<ObjectId>,
  added: ObjectId[],
): void {
  const visited = new Set<ObjectId>([root]);
  const pending = [...hierarchy.childrenOf(root)];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (visited.has(id)) continue;
    visited.add(id);
    const object = changes.get(id);
    if (!listed.has(id) && object?.type === 'frame' && object.showName === undefined) {
      added.push(id);
    }
    pending.push(...hierarchy.childrenOf(id));
  }
}

/**
 * The change set as the scene and its passes read it, with each frame's name display resolved:
 * a frame without a stored `showName` reads with the value `isFrameNameShown` gives
 * it over the document, so a pass decides from the frame alone (`showName !== false`), and
 * record counts stay pure functions of the object. The default depends on the frame's
 * ancestors, so when an object is created, deleted or moved to another parent, the frames
 * without `showName` in its subtree (in the scene's hierarchy, as last applied) are listed as
 * updated too, and read again. A plain move or restyle walks nothing, and a root move batch
 * (root objects staying at the root) is returned as it is. Resolved once per change set, never
 * per drawn frame. Pure: the change set is wrapped, never mutated.
 *
 * @param changes - The change set, after the drawable gate.
 * @param hierarchy - The scene's hierarchy, as last applied.
 * @returns The change set the scene applies.
 */
export function withResolvedFrameNames(
  changes: SceneChangeSet,
  hierarchy: SceneHierarchy,
): SceneChangeSet {
  if (isRootMoveChanges(changes)) return changes;
  const listed = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
  const added: ObjectId[] = [];
  for (const id of listed) {
    const object = changes.get(id);
    const isSameParent =
      object !== undefined && hierarchy.has(id) && hierarchy.parentOf(id) === object.parentId;
    if (!isSameParent) collectFrames(id, hierarchy, changes, listed, added);
  }
  const lookup = (id: ObjectId): BoardObject | undefined => changes.get(id);
  const resolved = new Map<ObjectId, BoardObject | undefined>();
  return {
    created: changes.created,
    updated: added.length === 0 ? changes.updated : [...changes.updated, ...added],
    deleted: changes.deleted,
    get: (id) => {
      if (resolved.has(id)) return resolved.get(id);
      const object = changes.get(id);
      const next =
        object?.type === 'frame' && object.showName === undefined
          ? { ...object, showName: isFrameNameShown(object, lookup) }
          : object;
      resolved.set(id, next);
      return next;
    },
  };
}

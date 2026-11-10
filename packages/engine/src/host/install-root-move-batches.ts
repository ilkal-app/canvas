import type { BoardObject } from '@canvas/schema';

import type { Frame } from '../scene/frame.js';
import { canUseRootMoveBatch } from '../scene/root-move-batch-guards.js';
import { withRootMoveBatch } from '../scene/root-move-batch.js';
import { isRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

/**
 * Shares current root objects only while the host's standard collection stages run. Install
 * before external overlay wrappers, so their before/after callbacks stay outside the snapshot.
 * EngineAssembly supplies only standard passes and the engine-owned pass environment; custom
 * SceneRenderer instances keep their ordinary live-source semantics. Pass guards refuse
 * snapshots when resource tracking could call external code synchronously.
 *
 * @param frame - The engine assembly's frame.
 */
export function installRootMoveBatches(frame: Frame): void {
  frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run: (context) => {
      const changes = context.changes.drain();
      if (changes) context.changes.push(changes);
      const objects = changes && rootObjects(changes);
      if (changes && objects && canUseRootMoveBatch(context.scene.passes, objects))
        withRootMoveBatch(changes, objects, () => {
          inner.run(context);
        });
      else inner.run(context);
    },
  }));
}

/**
 * Reads the final source once; admission never changes scene state. The host's validated
 * update-only provenance supplies unique ids, and queue merging preserves that uniqueness.
 *
 * @param changes - Final coalesced changes.
 * @returns The root objects, or undefined when ordinary collection is required.
 */
function rootObjects(changes: SceneChangeSet): BoardObject[] | undefined {
  if (!isRootMoveChanges(changes) || changes.created.length > 0 || changes.deleted.length > 0)
    return undefined;
  const objects: BoardObject[] = [];
  for (const id of changes.updated) {
    const object = changes.get(id);
    if (
      object?.id !== id ||
      object.parentId !== null ||
      object.type === 'frame' ||
      object.type === 'group'
    )
      return undefined;
    objects.push(object);
  }
  return objects;
}

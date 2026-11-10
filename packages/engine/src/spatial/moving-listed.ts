import type { SceneChangeSet } from '../scene/scene-source.js';

import type { MovingBoxes } from './moving-boxes.js';

/**
 * Whether a change set names a root leaf a retained move is placing: the move must
 * end before the change is applied.
 *
 * @param moving - The move's boxes.
 * @param changes - The change set.
 * @returns True when it creates, updates or deletes a moving leaf.
 */
export function isMovingListed(moving: MovingBoxes, changes: SceneChangeSet): boolean {
  return [changes.created, changes.updated, changes.deleted].some((ids) =>
    ids.some((id) => moving.has(id)),
  );
}

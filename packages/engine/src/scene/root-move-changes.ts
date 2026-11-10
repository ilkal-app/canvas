import type { SceneChangeSet } from './scene-source.js';

const placements = new WeakSet<SceneChangeSet>();

/**
 * Marks an engine-created update whose only changed fields are root x/y positions.
 * Never inferred from serialized object properties; ordinary changes carry no proof.
 *
 * @param changes - The validated host update, or a merge containing only such updates.
 * @returns The same update with an internal proof.
 */
export function markRootMoveChanges(changes: SceneChangeSet): SceneChangeSet {
  placements.add(changes);
  return changes;
}

/**
 * Tests engine-owned placement provenance, without reading user object fields.
 *
 * @param changes - The update to inspect.
 * @returns Whether all its changed fields are retained root placements.
 */
export function isRootMoveChanges(changes: SceneChangeSet): boolean {
  return placements.has(changes);
}

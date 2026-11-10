import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SceneChangeSet } from './scene-source.js';

/**
 * A host-owned retained base and its current positions; borrowed for synchronous reads. Each root
 * is at `positions` plus `delta` when there is one (a translation from the begin
 * positions, which `positions` then are), else at `positions`.
 */
export interface RootMovePlacement {
  readonly ids: readonly ObjectId[];
  readonly objects: readonly BoardObject[];
  readonly positions: Float64Array;
  readonly delta?: readonly [number, number];
}

const readers = new WeakMap<SceneChangeSet, () => RootMovePlacement | undefined>();

/**
 * Attaches a live placement reader to an accepted host update only. Ordinary root-move marks
 * and merged queues do not grant this stronger provenance.
 *
 * @param changes - The accepted update.
 * @param read - Reads the mirror's current session; never captures an old position snapshot.
 * @returns The same change set.
 */
export function markRootMovePlacement(
  changes: SceneChangeSet,
  read: () => RootMovePlacement | undefined,
): SceneChangeSet {
  readers.set(changes, read);
  return changes;
}

/**
 * Reads current placement. Consumers must validate membership against the change set: an old
 * change set can read a newer session, or no session after ordinary edits or an end command.
 *
 * @param changes - The update whose private provenance is checked.
 * @returns The current borrowed placement, or undefined without an active trusted reader.
 */
export function getRootMovePlacement(changes: SceneChangeSet): RootMovePlacement | undefined {
  return readers.get(changes)?.();
}

import type { BoardObject } from '@canvas/schema';

import type { SceneChangeSet } from './scene-source.js';

const batches = new WeakMap<SceneChangeSet, readonly BoardObject[]>();

/**
 * Reads a host-owned snapshot during synchronous collection only. Ordinary live source reads
 * remain unchanged; consumers still preflight their own root hierarchy before using the array.
 *
 * @param changes - The coalesced change set currently being collected.
 * @returns Its scoped ordered objects, or undefined outside an admitted collection.
 */
export function getRootMoveBatch(changes: SceneChangeSet): readonly BoardObject[] | undefined {
  return batches.get(changes);
}

/**
 * Shares one ordered root snapshot among collection stages in the engine-owned environment.
 * The caller admits update-only provenance and unique matching ids; consumers check hierarchy.
 * Never retain this scope across asynchronous work or expose it to arbitrary pass callbacks.
 *
 * @param changes - The coalesced change set; its live get method is not modified.
 * @param objects - Exact objects for the updated ids, in the same order.
 * @param run - The synchronous collection stages.
 * @returns The stages' result.
 */
export function withRootMoveBatch<T>(
  changes: SceneChangeSet,
  objects: readonly BoardObject[],
  run: () => T,
): T {
  const previous = batches.get(changes);
  batches.set(changes, objects);
  try {
    return run();
  } finally {
    if (previous) batches.set(changes, previous);
    else batches.delete(changes);
  }
}

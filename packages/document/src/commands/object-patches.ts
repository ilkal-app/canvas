import type { ObjectId } from '@canvas/schema';

import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';

/** A change to some fields of one existing object, already validated as the merged object. */
export interface PlannedPatch {
  /** The object id. */
  readonly id: ObjectId;
  /** The fields to write; `runCommand` stamps `updatedAt` afterwards. */
  readonly patch: ObjectPatch;
}

/**
 * Writes planned patches, each through `patchObject`, which writes only the fields whose value
 * changed, so concurrent edits to other fields survive.
 *
 * @param transaction - The command's transaction.
 * @param patches - The patches.
 * @returns The ids patched, in plan order.
 */
export function applyPatches(
  transaction: DocumentTransaction,
  patches: readonly PlannedPatch[],
): ObjectId[] {
  for (const { id, patch } of patches) transaction.patchObject(id, patch);
  return patches.map(({ id }) => id);
}

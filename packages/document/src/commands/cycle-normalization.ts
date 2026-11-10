import type { BoardObject, ObjectId } from '@canvas/schema';

import type { DocumentStore } from '../store/document-store.js';
import { commandCycleRepairs } from '../store/internal.js';
import { validateObject } from '../store/object-validation.js';

import { errorsFromIssues, type CommandError } from './command-error.js';

/** A command's required cycle normalization, validated before its transaction starts. */
export interface CycleNormalization {
  /** Roots to materialize at their shown placement before applying the command. */
  readonly roots: readonly BoardObject[];
  /** Errors that refuse the entire command, without writes. */
  readonly errors: readonly CommandError[];
}

/**
 * Normalizes affected raw cycles so moving one member cannot change the shown root as a side
 * effect of recomputing the overlay. An invalid root refuses the whole command; validation is
 * never bypassed and the view never depends on a historical frozen placement.
 *
 * @param store - The readable board with any substrate-specific cycle overlay.
 * @param written - The command's already validated planned writes.
 * @returns Required roots and their validation errors.
 */
export function planCycleNormalization(
  store: DocumentStore,
  written: ReadonlyMap<ObjectId, BoardObject | null>,
): CycleNormalization {
  const changed = new Set<ObjectId>();
  for (const [id, next] of written) {
    const previous = store.get(id);
    if (
      previous !== undefined &&
      next !== null &&
      (next.parentId !== previous.parentId ||
        next.x !== previous.x ||
        next.y !== previous.y ||
        next.rotation !== previous.rotation)
    )
      changed.add(id);
  }
  const roots = commandCycleRepairs(store, changed).filter(({ id }) => {
    // A command that deletes or moves the root already materializes the displayed placement.
    return written.get(id) !== null && !changed.has(id);
  });
  const errors: CommandError[] = [];
  for (const root of roots) {
    const validation = validateObject(root, store.get(root.id));
    if (!validation.isValid)
      errors.push(...errorsFromIssues('invalid-object', root.id, validation.issues));
  }
  return { roots, errors };
}

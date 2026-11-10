import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

/** What a `setLocked` command is to do: the objects and whether they end locked. */
export interface LockChange {
  /** The selected objects that exist, in selection order: the command's `ids`. */
  readonly ids: readonly ObjectId[];
  /** Whether they end locked: the command's `locked`. */
  readonly isLocked: boolean;
}

/**
 * The objects of a selection that exist.
 *
 * @param ids - The selected ids.
 * @param source - The document's objects.
 * @returns Those with an object, in selection order.
 */
function existingIds(ids: readonly ObjectId[], source: Pick<SelectionSource, 'get'>): ObjectId[] {
  return ids.filter((id) => source.get(id) !== undefined);
}

/**
 * Whether a selection is locked as a whole: something is
 * selected and every selected object is locked. The overlay then shows the frame in the lock
 * style with a lock badge, and no resize handles or rotation bands. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document's objects.
 * @returns True when every selected object that exists is locked, and one does.
 */
export function isLockedSelection(
  ids: readonly ObjectId[],
  source: Pick<SelectionSource, 'get'>,
): boolean {
  const existing = existingIds(ids, source);
  return existing.length > 0 && existing.every((id) => source.get(id)?.locked === true);
}

/**
 * What lock or unlock (mod+shift+l) does to a selection, as one `setLocked` command, so one
 * undo step: a selection that is locked as a whole is unlocked; any other is locked, every
 * object with it, so a mixed selection ends locked. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document's objects.
 * @returns The command's input, or undefined when no selected object exists.
 */
export function lockToggleOf(
  ids: readonly ObjectId[],
  source: Pick<SelectionSource, 'get'>,
): LockChange | undefined {
  const existing = existingIds(ids, source);
  if (existing.length === 0) return undefined;
  return { ids: existing, isLocked: !isLockedSelection(existing, source) };
}

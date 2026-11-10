import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

/** The part of a selection an order command takes, and what it leaves. */
export interface OrderTarget {
  /** The selected objects of one parent, in selection order: the order command's `ids`. */
  readonly ids: readonly ObjectId[];
  /** The selected objects of other parents, left where they are, in selection order. */
  readonly leftOutIds: readonly ObjectId[];
}

/**
 * The objects of a selection that an order command moves. The
 * four order commands take the children of one parent, since sibling keys are comparable only
 * within a parent, so a selection spanning several parents is reordered on its largest
 * same-parent subset; a tie goes to the parent of the object selected first (the primary). Locked
 * objects stay in: a lock stops moves, not reordering. Ids with no object are dropped. Pure.
 *
 * @param ids - The selected ids, first primary.
 * @param source - The document's objects.
 * @returns The subset to reorder and the objects left out.
 */
export function orderTargetOf(
  ids: readonly ObjectId[],
  source: Pick<SelectionSource, 'get'>,
): OrderTarget {
  const byParent = new Map<ObjectId | null, ObjectId[]>();
  for (const id of ids) {
    const object = source.get(id);
    if (object === undefined) continue;
    byParent.set(object.parentId, [...(byParent.get(object.parentId) ?? []), id]);
  }
  let largest: readonly ObjectId[] = [];
  // Map order is first-selected order, so the strict comparison leaves a tie to the earlier parent.
  for (const siblings of byParent.values())
    if (siblings.length > largest.length) largest = siblings;
  const taken = new Set(largest);
  return {
    ids: largest,
    leftOutIds: [...byParent.values()].flat().filter((id) => !taken.has(id)),
  };
}

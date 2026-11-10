import type { ObjectId } from '@canvas/schema';

/**
 * What the select tool has selected: an ordered set of object ids and
 * the primary object, the one clicked or added last, which panels read their values from. A
 * plain value: every change makes a new state, and no function here changes the one it is
 * given. Selection is per person and never stored in the document.
 */
export interface SelectionState {
  /** The selected ids, in the order they were selected, without repeats. */
  readonly ids: readonly ObjectId[];
  /** The primary object, one of `ids`; undefined exactly when nothing is selected. */
  readonly primaryId: ObjectId | undefined;
}

/** Nothing selected. */
export const EMPTY_SELECTION: SelectionState = Object.freeze({
  ids: Object.freeze([]),
  primaryId: undefined,
});

/**
 * A selection of exactly these ids, the first primary: a click, a marquee, select all.
 *
 * @param ids - The ids; repeats are dropped, keeping the first.
 * @returns The selection.
 */
export function selectionOf(ids: Iterable<ObjectId>): SelectionState {
  const unique = [...new Set(ids)];
  return unique.length === 0 ? EMPTY_SELECTION : { ids: unique, primaryId: unique[0] };
}

/**
 * Whether an id is selected.
 *
 * @param selection - The selection.
 * @param id - The id.
 * @returns True when selected.
 */
export function isSelected(selection: SelectionState, id: ObjectId): boolean {
  return selection.ids.includes(id);
}

/**
 * Shift-click: adds an unselected id, which becomes the primary, or removes a selected one.
 * Removing the primary makes the most recently selected remaining id primary.
 *
 * @param selection - The selection; not changed.
 * @param id - The id to toggle.
 * @returns The next selection.
 */
export function toggleSelected(selection: SelectionState, id: ObjectId): SelectionState {
  if (!isSelected(selection, id)) return { ids: [...selection.ids, id], primaryId: id };
  const ids = selection.ids.filter((selected) => selected !== id);
  if (ids.length === 0) return EMPTY_SELECTION;
  return { ids, primaryId: selection.primaryId === id ? ids.at(-1) : selection.primaryId };
}

/**
 * Drops objects that no longer exist (deleted here or by a collaborator).
 *
 * @param selection - The selection; not changed.
 * @param deletedIds - The ids gone from the document.
 * @returns The selection without them; the same object when none of them was selected.
 */
export function withoutObjects(
  selection: SelectionState,
  deletedIds: Iterable<ObjectId>,
): SelectionState {
  const deleted = new Set(deletedIds);
  if (!selection.ids.some((id) => deleted.has(id))) return selection;
  const ids = selection.ids.filter((id) => !deleted.has(id));
  if (ids.length === 0) return EMPTY_SELECTION;
  return { ids, primaryId: ids.find((id) => id === selection.primaryId) ?? ids[0] };
}

/**
 * Whether two selections hold the same ids in the same order with the same primary.
 *
 * @param first - One selection.
 * @param second - Another.
 * @returns True when equal.
 */
export function isSameSelection(first: SelectionState, second: SelectionState): boolean {
  return (
    first.primaryId === second.primaryId &&
    first.ids.length === second.ids.length &&
    first.ids.every((id, index) => second.ids[index] === id)
  );
}

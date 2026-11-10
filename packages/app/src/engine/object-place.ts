import type { BoardObject } from '@canvas/schema';

/** The fields that place an object: its frame in its parent's, and its size where it has one. */
const PLACE_FIELDS = ['parentId', 'x', 'y', 'rotation', 'width', 'height'] as const;

/**
 * Whether two states of an object put it in the same place: the same parent, position,
 * rotation and size (a gesture's preview that moved, resized or rotated it does not).
 * Pure.
 *
 * @param first - One state.
 * @param second - Another.
 * @returns True when every placing field matches.
 */
export function hasSamePlace(first: BoardObject, second: BoardObject): boolean {
  const one = first as unknown as Readonly<Record<string, unknown>>;
  const other = second as unknown as Readonly<Record<string, unknown>>;
  return PLACE_FIELDS.every((field) => one[field] === other[field]);
}

/**
 * A key of an object's place: equal for two states exactly when {@link hasSamePlace} holds
 * (a collaborator's resize changes it though the comment pin's point may not move).
 * Pure.
 *
 * @param object - The object.
 * @returns The key.
 */
export function placeKeyOf(object: BoardObject): string {
  const fields = object as unknown as Readonly<Record<string, unknown>>;
  return JSON.stringify(PLACE_FIELDS.map((field) => fields[field] ?? null));
}

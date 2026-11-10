import {
  compareSiblings,
  isValidKey,
  MAX_KEY_LENGTH,
  type ObjectId,
  type SiblingKey,
} from '@canvas/schema';

import { describeValue } from '../codec/describe-value.js';
import { generateObjectKeys } from '../z-order/object-keys.js';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';

// Where commands that add objects to a parent put them in its stack (z-order
// is a fractional index). The keys come from `src/z-order/`, each ending in the
// object's tag, so objects placed in the same gap by one command, or by two clients at once,
// always get distinct keys. No command copies another object's key: two clients copying the
// same one at once would give two siblings one key. A board can hold keys that are not
// fractional-index keys (imported before the schema checks `z`); when one is in the way, the
// command is refused with `unorderable-neighbours` rather than throwing.

/**
 * Generates keys between two bounds when both are usable and the keys fit `MAX_KEY_LENGTH`.
 *
 * @param lower - The lower bound, or `null`.
 * @param upper - The upper bound, or `null`.
 * @param ids - The objects, bottom first.
 * @returns The keys, or `undefined` when a bound is not a valid key or a key would be too long.
 */
function keysBetween(
  lower: string | null,
  upper: string | null,
  ids: readonly ObjectId[],
): string[] | undefined {
  const isUsable = (key: string | null) => key === null || isValidKey(key);
  if (
    !isUsable(lower) ||
    !isUsable(upper) ||
    (lower !== null && upper !== null && lower >= upper)
  ) {
    return undefined;
  }
  const keys = generateObjectKeys(lower, upper, ids);
  return keys.every((key) => key.length <= MAX_KEY_LENGTH) ? keys : undefined;
}

/**
 * The key of a parent's top child, from the store's `topChildOf`: O(1) while the top only
 * rises (objects created at the front); the first query after the top child moves down or away
 * rescans that parent's children once.
 *
 * @param board - The board.
 * @param parentId - The parent, or `null` for the root.
 * @returns The key, or `null` when the parent has no children.
 */
function topKey(board: BoardReader, parentId: ObjectId | null): string | null {
  const top = board.references.topChildOf(parentId);
  return (top === undefined ? undefined : board.get(top)?.z) ?? null;
}

/**
 * The refusal when no key fits above a parent's top child.
 *
 * @param board - The board.
 * @param parentId - The parent.
 * @param objectId - The object that could not be placed, or `null`.
 * @param path - Where in the command's input the placement comes from.
 * @returns The error.
 */
function noKeyAbove(
  board: BoardReader,
  parentId: ObjectId | null,
  objectId: ObjectId | null,
  path: readonly (string | number)[],
): CommandError {
  const where = parentId === null ? 'the board root' : `"${parentId}"`;
  const key = describeValue(topKey(board, parentId));
  return commandError(
    'unorderable-neighbours',
    objectId,
    path,
    `no stacking key fits above the top of ${where}, whose key ${key} is not a fractional-index key`,
  );
}

/**
 * The z key for a new object placed above every current child of a parent (on top of the
 * stack), as creating an object or a connector does. O(1) while the top only rises; the first
 * placement after the top child moves down or away rescans that parent once.
 *
 * @param board - The board before the command.
 * @param parentId - The new object's parent, or `null` for the root.
 * @param id - The new object's id, whose tag the key ends in.
 * @param path - Where in the command's input the placement comes from, for the error.
 * @param errors - Where to add the refusal when no key fits.
 * @returns A key above every sibling's key, or `undefined` (with an `unorderable-neighbours`
 *   error added) when the top child's key is not a fractional-index key.
 */
export function nextZAbove(
  board: BoardReader,
  parentId: ObjectId | null,
  id: ObjectId,
  path: readonly (string | number)[],
  errors: CommandError[],
): string | undefined {
  const [key] = zKeysOnTop(board, parentId, [id], path, errors) ?? [];
  return key;
}

/**
 * Keys for objects placed, in order, above every current child of a parent (on top of its
 * stack), as a move that takes objects into a frame does. O(1) while the top only
 * rises, like {@link nextZAbove}.
 *
 * @param board - The board before the command.
 * @param parentId - The parent, or `null` for the root.
 * @param ids - The objects to place, bottom first; at least one, the first named in the error.
 * @param path - Where in the command's input the placement comes from, for the error.
 * @param errors - Where to add the refusal when no key fits.
 * @returns One ascending key per id, each ending in its object's tag, or `undefined` (with an
 *   `unorderable-neighbours` error added) when the top child's key is not a fractional-index key.
 */
export function zKeysOnTop(
  board: BoardReader,
  parentId: ObjectId | null,
  ids: readonly [ObjectId, ...ObjectId[]],
  path: readonly (string | number)[],
  errors: CommandError[],
): string[] | undefined {
  const keys = keysBetween(topKey(board, parentId), null, ids);
  if (keys === undefined) errors.push(noKeyAbove(board, parentId, ids[0], path));
  return keys;
}

/**
 * Keys for objects placed, in order, directly above the stacking position `key` among a
 * parent's children: above `key` and below the lowest sibling key greater than it, ignoring the
 * sibling `excludedId`. Ungrouping uses it to put a group's children where the group was, with
 * the group itself excluded; grouping uses it to put the new group where its topmost member was,
 * excluding nothing (the group never copies the member's key, so two groups made at once
 * around one member get distinct keys). Groups ungrouped together keep their relative order: each
 * one's children stay below the next group's key. When `key` or that next key is not a
 * fractional-index key, or the keys would exceed `MAX_KEY_LENGTH`, the objects go on top of the
 * parent's stack instead. One lookup per sibling.
 *
 * @param board - The board before the command.
 * @param parentId - The parent, or `null` for the root.
 * @param key - The stacking position to insert above.
 * @param excludedId - A sibling to ignore (the group being removed), or `null`.
 * @param ids - The objects to place, bottom first.
 * @param path - Where in the command's input the placement comes from, for the error.
 * @param errors - Where to add the refusal when no key fits anywhere.
 * @returns One ascending key per id, or `undefined` (with an `unorderable-neighbours` error
 *   added) when the top of the stack cannot be used either.
 */
export function zKeysAbove(
  board: BoardReader,
  parentId: ObjectId | null,
  key: string,
  excludedId: ObjectId | null,
  ids: readonly ObjectId[],
  path: readonly (string | number)[],
  errors: CommandError[],
): string[] | undefined {
  if (ids.length === 0) return [];
  let upper: string | null = null;
  for (const childId of board.references.childrenOf(parentId)) {
    const sibling = childId === excludedId ? undefined : board.get(childId)?.z;
    if (sibling !== undefined && sibling > key && (upper === null || sibling < upper)) {
      upper = sibling;
    }
  }
  const keys = keysBetween(key, upper, ids) ?? keysBetween(topKey(board, parentId), null, ids);
  if (keys === undefined) errors.push(noKeyAbove(board, parentId, excludedId, path));
  return keys;
}

/**
 * Keys for objects placed, in order, directly below a sibling `belowId` among a parent's children
 * (or on top of its stack when `belowId` is `null`), as the layers panel's drop does:
 * above the highest other child below that sibling and below the sibling itself, the moved
 * objects (`excluded`) left out of the neighbours, since they leave their places. Siblings are
 * compared by key, ties by id (`compareSiblings`). One lookup per child of the parent.
 *
 * @param board - The board before the command.
 * @param parentId - The parent, or `null` for the root.
 * @param belowId - The child the objects go directly below, or `null` for the top.
 * @param excluded - The objects being placed, which are not neighbours.
 * @param ids - The objects to place, bottom first; at least one, the first named in the error.
 * @param path - Where in the command's input the placement comes from, for the error.
 * @param errors - Where to add the refusal when no key fits.
 * @returns One ascending key per id, or `undefined` (with an `unorderable-neighbours` error
 *   added) when a neighbour's key is not a fractional-index key or no key fits between them.
 */
export function zKeysBelow(
  board: BoardReader,
  parentId: ObjectId | null,
  belowId: ObjectId | null,
  excluded: ReadonlySet<ObjectId>,
  ids: readonly [ObjectId, ...ObjectId[]],
  path: readonly (string | number)[],
  errors: CommandError[],
): string[] | undefined {
  const upperObject = belowId === null ? undefined : board.get(belowId);
  const upper: SiblingKey | null =
    upperObject === undefined ? null : { id: upperObject.id, z: upperObject.z };
  let lower: SiblingKey | null = null;
  for (const childId of board.references.childrenOf(parentId)) {
    const child = excluded.has(childId) || childId === belowId ? undefined : board.get(childId);
    if (child === undefined) continue;
    const key = { id: childId, z: child.z };
    const isBelowUpper = upper === null || compareSiblings(key, upper) < 0;
    if (isBelowUpper && (lower === null || compareSiblings(key, lower) > 0)) lower = key;
  }
  const keys = keysBetween(lower?.z ?? null, upper?.z ?? null, ids);
  if (keys === undefined) {
    const where = belowId === null ? 'on top' : `below "${belowId}"`;
    const message = `no stacking key fits ${where} between keys ${describeValue(lower?.z ?? null)} and ${describeValue(upper?.z ?? null)}`;
    errors.push(commandError('unorderable-neighbours', ids[0], path, message));
  }
  return keys;
}

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

// Entering groups. A click on a grouped
// object selects its outermost group; a double-click enters that group, so clicks and marquees
// then act on its children, and Escape or a click outside leaves one level. The select tool
// keeps one id, `SelectToolState.enteredGroupId`: the innermost entered group. The levels above
// it are implied, and read from the document every time, so they cannot go stale: the entered
// group's chain is the group and its parents for as long as they are groups (a frame breaks
// the chain, as it breaks the walk of `selectTargetOf`, so a group inside a frame inside a
// group is entered on its own). These helpers are pure and shared: the select tool's hit
// testing, its marquee and select all, and select same type scope by them.

/**
 * An object's parent.
 *
 * @param object - The object, or undefined.
 * @param source - The document.
 * @returns The parent, or undefined at the root or for a missing parent.
 */
function parentOf(
  object: BoardObject | undefined,
  source: SelectionSource,
): BoardObject | undefined {
  const parentId = object?.parentId ?? null;
  return parentId === null ? undefined : source.get(parentId);
}

/**
 * The groups entered with `enteredGroupId` entered: it and each parent for as long as the
 * parents are groups. Empty when nothing is entered or the group is gone. O(depth).
 *
 * @param enteredGroupId - The innermost entered group, or null.
 * @param source - The document.
 * @returns The entered groups' ids.
 */
export function enteredChainOf(
  enteredGroupId: ObjectId | null,
  source: SelectionSource,
): ReadonlySet<ObjectId> {
  const chain = new Set<ObjectId>();
  let group = enteredGroupId === null ? undefined : source.get(enteredGroupId);
  while (group?.type === 'group' && !chain.has(group.id)) {
    chain.add(group.id);
    group = parentOf(group, source);
  }
  return chain;
}

/**
 * The entered group a select target sits in, which becomes the innermost entered group when
 * it is pressed: its parent when that is one of the entered groups, else none (a press outside
 * the entered groups leaves them all; one on another child of an outer entered group leaves
 * the inner ones). O(depth).
 *
 * @param targetId - A select target (`selectTargetOf` with the same entered group).
 * @param source - The document.
 * @param enteredGroupId - The innermost entered group now, or null.
 * @returns The entered group after the press, or null.
 */
export function scopeOfTarget(
  targetId: ObjectId,
  source: SelectionSource,
  enteredGroupId: ObjectId | null,
): ObjectId | null {
  const parentId = source.get(targetId)?.parentId ?? null;
  return parentId !== null && enteredChainOf(enteredGroupId, source).has(parentId)
    ? parentId
    : null;
}

/**
 * The group one level up from an entered group, where Escape or a click on empty board leaves
 * to: its parent when that is a group, else none.
 *
 * @param groupId - The entered group, or null.
 * @param source - The document.
 * @returns The outer group, or null.
 */
export function outerGroupOf(groupId: ObjectId | null, source: SelectionSource): ObjectId | null {
  const parent = parentOf(groupId === null ? undefined : source.get(groupId), source);
  return parent?.type === 'group' ? parent.id : null;
}

/**
 * The selection scope inside an entered group: its children, which select all selects and
 * select same type searches.
 *
 * @param enteredGroupId - The innermost entered group, or null.
 * @param source - The document.
 * @returns The children's ids, or undefined when no group is entered (or it is gone).
 */
export function enteredScopeIds(
  enteredGroupId: ObjectId | null,
  source: SelectionSource,
): readonly ObjectId[] | undefined {
  if (enteredGroupId === null || source.get(enteredGroupId)?.type !== 'group') return undefined;
  return [...source.childrenOf(enteredGroupId)];
}

/**
 * Whether an object is inside the entered group, where a marquee acts: under it at any depth.
 * Everything is, when no group is entered. A parent cycle ends the walk. O(depth).
 *
 * @param id - The object.
 * @param enteredGroupId - The innermost entered group, or null.
 * @param source - The document.
 * @returns True when the object is inside.
 */
export function isInsideEnteredGroup(
  id: ObjectId,
  enteredGroupId: ObjectId | null,
  source: SelectionSource,
): boolean {
  if (enteredGroupId === null) return true;
  const visited = new Set<ObjectId>([id]);
  for (let parent = parentOf(source.get(id), source); parent; parent = parentOf(parent, source)) {
    if (parent.id === enteredGroupId) return true;
    if (visited.has(parent.id)) return false;
    visited.add(parent.id);
  }
  return false;
}

/**
 * What entering a group selects: the object under `world` at the group's level, as a
 * double press on it asks; or, with no point or nothing of the group's there, its unlocked
 * children (entering by other means than a press on one of them).
 *
 * @param groupId - The group entered.
 * @param source - The document.
 * @param hitAt - The select target under a point with the group entered, if any (the hit
 *   tester's `hitPoint` at the entered level), and the level it sits at.
 * @returns The ids to select.
 */
export function selectionOnEntering(
  groupId: ObjectId,
  source: SelectionSource,
  hitAt: (() => { readonly id: ObjectId; readonly scope: ObjectId | null } | undefined) | undefined,
): readonly ObjectId[] {
  const hit = hitAt?.();
  if (hit?.scope === groupId) return [hit.id];
  return (enteredScopeIds(groupId, source) ?? []).filter(
    (childId) => source.get(childId)?.locked === false,
  );
}

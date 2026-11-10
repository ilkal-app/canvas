import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from './selection-geometry.js';

/**
 * What the selection's frame depends on besides the selected objects themselves, so the select
 * controller can tell whether a change set can move its frame (a change set that
 * touches none of it must cost nothing, since remote edits arrive hundreds of times a second
 * with twenty collaborators).
 */
export interface SelectionRelations {
  /**
   * The selected ids, all their ancestors (a parent's transform places its children), every
   * object under a selected group (a group's box is its children's) or frame (whether it is far
   * depends on what it carries), and a selected connector's targets with their ancestors
   * and, for a group target, what is under it (its route follows them).
   */
  readonly ids: ReadonlySet<ObjectId>;
  /**
   * The selected groups and frames, the groups a selected connector is attached to,
   * and every object under them.
   */
  readonly groupSubtree: ReadonlySet<ObjectId>;
  /**
   * Whether a group or frame is selected, or a selected connector is attached to a group: only
   * then can a new or moved object join the frame, move the connector's route, or make a
   * selected frame far.
   */
  readonly hasGroup: boolean;
}

/** The relations of an empty selection: no change set touches it. */
export const NO_RELATIONS: SelectionRelations = Object.freeze({
  ids: new Set<ObjectId>(),
  groupSubtree: new Set<ObjectId>(),
  hasGroup: false,
});

/** The ids a change set touched, as `ChangeSet` of `@canvas/document` lists them. */
export interface TouchedIds {
  /** Objects created. */
  readonly created: readonly ObjectId[];
  /** Objects updated. */
  readonly updated: readonly ObjectId[];
  /** Objects deleted. */
  readonly deleted: readonly ObjectId[];
}

/**
 * Adds an object's ancestors, stopping at one already held (its chain is then held too).
 *
 * @param objectId - The object.
 * @param source - The document.
 * @param into - The set to add to.
 */
function addAncestors(objectId: ObjectId, source: SelectionSource, into: Set<ObjectId>): void {
  let parent = source.get(objectId)?.parentId ?? null;
  while (parent !== null && !into.has(parent)) {
    into.add(parent);
    parent = source.get(parent)?.parentId ?? null;
  }
}

/**
 * Adds a group and everything under it.
 *
 * @param groupId - The group.
 * @param source - The document.
 * @param into - The sets to add to.
 */
function addSubtree(groupId: ObjectId, source: SelectionSource, into: Set<ObjectId>[]): void {
  const stack = [groupId];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const set of into) set.add(next);
    for (const child of source.childrenOf(next)) stack.push(child);
  }
}

/**
 * Adds a connector's target, its ancestors and, for a group, everything under it, recorded as a
 * group subtree too (a group's bounds are its children's, so an object arriving under it moves
 * the route): what the connector's route follows. A frame's bounds are its own box, so a frame
 * target's children are not followed.
 *
 * @param targetId - The target.
 * @param source - The document.
 * @param into - The related ids.
 * @param groupSubtree - The group subtrees, which arrivals are checked against.
 */
function addTarget(
  targetId: ObjectId,
  source: SelectionSource,
  into: Set<ObjectId>,
  groupSubtree: Set<ObjectId>,
): void {
  into.add(targetId);
  addAncestors(targetId, source, into);
  if (source.get(targetId)?.type === 'group') addSubtree(targetId, source, [into, groupSubtree]);
}

/**
 * The relations of a selection: built when the selection changes or a change set touches it,
 * in O(selection × depth) plus the size of selected groups' subtrees. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The relations.
 */
export function selectionRelationsOf(
  ids: readonly ObjectId[],
  source: SelectionSource,
): SelectionRelations {
  const related = new Set<ObjectId>(ids);
  const groupSubtree = new Set<ObjectId>();
  for (const objectId of ids) {
    addAncestors(objectId, source, related);
    const object = source.get(objectId);
    if (object?.type === 'group' || object?.type === 'frame') {
      addSubtree(objectId, source, [related, groupSubtree]);
    } else if (object?.type === 'connector') {
      for (const end of [object.from, object.to]) {
        if (end.kind === 'object') addTarget(end.objectId, source, related, groupSubtree);
      }
    }
  }
  return { ids: related, groupSubtree, hasGroup: groupSubtree.size > 0 };
}

/**
 * Whether a change set can change the selection's frame, resize flag or outlines: it touches a
 * related id (a selected object, an ancestor, anything under a selected group), or, with a group
 * selected, it created or updated an object now under that group (found by walking up its
 * parents, O(depth) per touched id). Without a selected group it reads nothing from the
 * document: O(1) per touched id, whatever the selection's size. Pure.
 *
 * @param changes - The ids the change set touched.
 * @param relations - The selection's relations before the change.
 * @param source - The document after the change.
 * @returns True when the selection's frame may have changed.
 */
export function isChangeRelated(
  changes: TouchedIds,
  relations: SelectionRelations,
  source: SelectionSource,
): boolean {
  const { created, updated, deleted } = changes;
  const touches = (objectId: ObjectId): boolean => relations.ids.has(objectId);
  if (created.some(touches) || updated.some(touches) || deleted.some(touches)) return true;
  if (!relations.hasGroup) return false;
  return [...created, ...updated].some((objectId) => {
    const seen = new Set<ObjectId>([objectId]);
    let parent = source.get(objectId)?.parentId ?? null;
    while (parent !== null && !seen.has(parent)) {
      if (relations.groupSubtree.has(parent)) return true;
      seen.add(parent);
      parent = source.get(parent)?.parentId ?? null;
    }
    return false;
  });
}

import type { ObjectId } from '@canvas/schema';

import { SiblingLists, type StackedObject } from './sibling-lists.js';
import { compareStacking } from './stacking-order.js';

export type { StackedObject } from './sibling-lists.js';

/**
 * The order the board paints in, bottom first (z-order is a fractional
 * index): a depth-first walk from the root in which every parent paints before its children
 * (a frame's background under its contents) and siblings paint by {@link compareStacking}, so
 * a group's whole subtree sits between its lower and upper siblings. As in `worldTransformOf`,
 * an object whose parent is missing paints as a root object, and objects caught in a parent
 * cycle (which `validateBoard` reports) paint last, once each, rather than failing the frame.
 * Pure; O(n log n), the sorting of every parent's children.
 *
 * @param objects - Every object, in any order; not mutated.
 * @returns Their ids, bottom first.
 */
export function paintOrderOf(objects: readonly StackedObject[]): ObjectId[] {
  return paintOrderOfSiblings(SiblingLists.of(objects));
}

/**
 * The same order as {@link paintOrderOf}, walked over sibling lists that are already sorted
 * (`ZOrderSegments` keeps them up to date from change sets): O(n), no sort, unless objects sit
 * under a missing parent or in a parent cycle, which are sorted as they are found.
 *
 * @param lists - Every object's parent's children, sorted; read, never mutated.
 * @returns Every object's id, bottom first.
 */
export function paintOrderOfSiblings(lists: SiblingLists): ObjectId[] {
  return paintRanksOfSiblings(lists).ids;
}

/**
 * The paint ranks of a board whose objects may also paint after their descendants (
 * a frame's outline, over its own subtree): {@link paintOrderOfSiblings}'s order, with a second,
 * closing rank for each object `hasClosingRank` names, right after its last descendant and
 * before its next sibling. Without closing ranks the ids are exactly
 * {@link paintOrderOfSiblings}'s. Pure; O(n) as that walk.
 */
export interface PaintRanks {
  /** Per rank, bottom first: its object (an object with a closing rank appears twice). */
  readonly ids: ObjectId[];
  /** Per rank, 1 where it is its object's closing rank. */
  readonly isClosingRank: Uint8Array;
  /** How many closing ranks there are. */
  readonly closingCount: number;
  /**
   * Whether the walk reached every object from the root list: no object under a missing parent
   * or in a parent cycle. Only then does a root created above every other paint last
   * (`ZOrderSegments` appends it instead of walking again).
   */
  readonly isFromRoots: boolean;
}

/**
 * Walks sibling lists as {@link paintOrderOfSiblings} does, adding a closing rank after the
 * subtree of each object `hasClosingRank` names (see {@link PaintRanks}).
 *
 * @param lists - Every object's parent's children, sorted; read, never mutated.
 * @param hasClosingRank - Whether an object paints again after its descendants; default none.
 * @returns The ranks, bottom first.
 */
export function paintRanksOfSiblings(
  lists: SiblingLists,
  hasClosingRank: (id: ObjectId) => boolean = () => false,
): PaintRanks {
  let roots = lists.childrenOf(null);
  const orphans = [...lists.parents()].filter(
    (parentId): parentId is ObjectId => parentId !== null && !lists.has(parentId),
  );
  if (orphans.length > 0) {
    roots = [...roots, ...orphans.flatMap((parentId) => lists.childrenOf(parentId))].sort(
      compareStacking,
    );
  }
  const order: ObjectId[] = [];
  // The ranks that close an object's subtree, in rank order.
  const closing: number[] = [];
  // Each object sits in one parent's list, so the walk from the roots reaches it at most once;
  // only the walk into parent cycles needs to remember what it painted. A pending id string (not
  // an object) is a closing rank, popped once the object's subtree is painted.
  const paint = (first: StackedObject, visited?: Set<ObjectId>): void => {
    const pending: (StackedObject | ObjectId)[] = [first];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (typeof next === 'string') {
        closing.push(order.length);
        order.push(next);
        continue;
      }
      if (visited !== undefined) {
        if (visited.has(next.id)) continue;
        visited.add(next.id);
      }
      order.push(next.id);
      if (hasClosingRank(next.id)) pending.push(next.id);
      const children = lists.childrenOf(next.id);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child) pending.push(child);
      }
    }
  };
  for (const root of roots) paint(root);
  const isFromRoots = orphans.length === 0 && order.length - closing.length === lists.size;
  if (order.length - closing.length < lists.size) {
    // Only parent cycles are unreachable from the root; paint them in stacking order.
    const visited = new Set(order);
    const unreached = [...lists.parents()]
      .flatMap((parentId) => lists.childrenOf(parentId))
      .filter(({ id }) => !visited.has(id))
      .sort(compareStacking);
    for (const object of unreached) paint(object, visited);
  }
  const isClosingRank = new Uint8Array(order.length);
  for (const rank of closing) isClosingRank[rank] = 1;
  return { ids: order, isClosingRank, closingCount: closing.length, isFromRoots };
}

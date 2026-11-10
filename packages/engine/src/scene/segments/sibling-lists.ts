import type { ObjectId } from '@canvas/schema';

import { compareStacking, type StackingKey } from './stacking-order.js';

/** What the sibling lists read of an object: its id, `z` key and parent. */
export interface StackedObject extends StackingKey {
  /** The group or frame it belongs to, or null at the board root. */
  readonly parentId: ObjectId | null;
}

/**
 * Finds where a sibling belongs in a list sorted by {@link compareStacking}: the index of the
 * first sibling that stacks above it. Binary search, O(log n).
 *
 * @param siblings - Siblings, bottom first.
 * @param object - The sibling to place.
 * @returns The insertion index.
 */
function insertionIndex(siblings: readonly StackedObject[], object: StackedObject): number {
  let low = 0;
  let high = siblings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const sibling = siblings[middle];
    if (sibling !== undefined && compareStacking(sibling, object) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Merges two lists sorted by {@link compareStacking} into one, O(n + k).
 *
 * @param first - A sorted list.
 * @param second - Another sorted list.
 * @returns A new sorted list holding both.
 */
function mergeSorted(
  first: readonly StackedObject[],
  second: readonly StackedObject[],
): StackedObject[] {
  const merged: StackedObject[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const a = first[i];
    const b = second[j];
    if (a === undefined || b === undefined) break;
    if (compareStacking(b, a) < 0) {
      merged.push(b);
      j += 1;
    } else {
      merged.push(a);
      i += 1;
    }
  }
  return merged.concat(first.slice(i), second.slice(j));
}

/**
 * The batch size from which {@link SiblingLists.replaceAll} rebuilds each touched parent's list
 * once instead of splicing per object: a splice moves the rest of the list, so thousands of them
 * on one parent (a page switch takes a whole page off the board root and puts another on)
 * cost O(n²).
 */
export const SIBLING_BATCH_THRESHOLD = 64;

/** One object's change for {@link SiblingLists.replaceAll}: its state before and after. */
export type SiblingChange = readonly [
  previous: StackedObject | undefined,
  next: StackedObject | undefined,
];

/**
 * Every parent's children in stacking order, bottom first, kept sorted as objects arrive, move
 * and leave (z-order is a fractional index, siblings by `z` then id). A
 * change costs a binary search and one splice in its parent's list, so a reorder on a 50k-child
 * parent no longer re-sorts the parent (the schema README's "keep sibling order
 * incrementally"). Lists are keyed by the stored `parentId`, whether or not that parent exists;
 * the paint walk decides what a missing parent means. CPU-only; the frame's thread.
 */
export class SiblingLists {
  private readonly childrenByParent = new Map<ObjectId | null, StackedObject[]>();
  private readonly ids = new Set<ObjectId>();

  /**
   * Builds the lists from a set of objects at once: one sort per parent, O(n log n).
   *
   * @param objects - Every object, in any order; not mutated.
   * @returns The lists.
   */
  static of(objects: Iterable<StackedObject>): SiblingLists {
    const lists = new SiblingLists();
    for (const object of objects) {
      lists.listOf(object.parentId).push(object);
      lists.ids.add(object.id);
    }
    for (const siblings of lists.childrenByParent.values()) siblings.sort(compareStacking);
    return lists;
  }

  /**
   * How many objects the lists hold.
   *
   * @returns The count.
   */
  get size(): number {
    return this.ids.size;
  }

  /**
   * Whether the lists hold an object.
   *
   * @param id - The object id.
   * @returns `true` when some parent's list holds it.
   */
  has(id: ObjectId): boolean {
    return this.ids.has(id);
  }

  /**
   * A parent's children, bottom first.
   *
   * @param parentId - The parent's id, or null for the board root.
   * @returns The children; empty when it has none. Read only: the list changes with the next
   *   {@link SiblingLists.replace}.
   */
  childrenOf(parentId: ObjectId | null): readonly StackedObject[] {
    return this.childrenByParent.get(parentId) ?? [];
  }

  /**
   * The parents that have children, the board root (`null`) included when it has any.
   *
   * @returns An iterator over the parent ids, in no particular order.
   */
  parents(): IterableIterator<ObjectId | null> {
    return this.childrenByParent.keys();
  }

  /**
   * Replaces what the lists hold of one object: removes its previous state from its previous
   * parent's list and inserts its next state into its next parent's, each by binary search.
   *
   * @param previous - The object as the lists hold it, or `undefined` when it is new.
   * @param next - The object as it is now, or `undefined` when it was removed.
   * @throws {Error} When `previous` is not in its parent's list (the caller skipped a change).
   */
  replace(previous: StackedObject | undefined, next: StackedObject | undefined): void {
    if (previous !== undefined) this.remove(previous);
    if (next !== undefined) {
      const siblings = this.listOf(next.parentId);
      siblings.splice(insertionIndex(siblings, next), 0, next);
      this.ids.add(next.id);
    }
  }

  /**
   * Where an object sits among its siblings (the sibling a created object paints
   * after). O(log n).
   *
   * @param object - The object as the lists hold it.
   * @returns Its index in its parent's list, or -1 when the lists do not hold it there.
   */
  indexOf(object: StackedObject): number {
    const siblings = this.childrenByParent.get(object.parentId);
    const index = siblings === undefined ? -1 : insertionIndex(siblings, object);
    return siblings?.[index]?.id === object.id ? index : -1;
  }

  /**
   * Whether an object the lists hold would keep its place among its siblings as `next`, under
   * the same parent: the same siblings just below and just above it, so the paint order is
   * unchanged (a committed stroke's real z key in place of its preview's). O(log n).
   *
   * @param previous - The object as the lists hold it.
   * @param next - The object as it is now, under the same parent.
   * @returns Whether it keeps its place; false when the lists do not hold `previous` there.
   */
  keepsPlace(previous: StackedObject, next: StackedObject): boolean {
    const siblings = this.childrenByParent.get(previous.parentId);
    if (siblings === undefined || next.parentId !== previous.parentId) return false;
    const index = insertionIndex(siblings, previous);
    if (siblings[index]?.id !== previous.id) return false;
    const below = siblings[index - 1];
    const above = siblings[index + 1];
    return (
      (below === undefined || compareStacking(below, next) < 0) &&
      (above === undefined || compareStacking(next, above) < 0)
    );
  }

  /**
   * Applies many {@link SiblingLists.replace} calls at once, with the same result. Below
   * {@link SIBLING_BATCH_THRESHOLD} changes it replaces one by one; from it, each parent's list
   * is filtered once for what left and merged once with what arrived (sorted), O(n + k log k)
   * per touched parent instead of a splice per object. No object may appear twice.
   *
   * @param changes - Each object's state before and after.
   * @throws {Error} When a previous state is not in its parent's list.
   */
  replaceAll(changes: readonly SiblingChange[]): void {
    if (changes.length < SIBLING_BATCH_THRESHOLD) {
      for (const [previous, next] of changes) this.replace(previous, next);
      return;
    }
    const leaving = new Map<ObjectId | null, Map<ObjectId, StackedObject>>();
    const arriving = new Map<ObjectId | null, StackedObject[]>();
    for (const [previous, next] of changes) {
      if (previous !== undefined) {
        let held = leaving.get(previous.parentId);
        if (held === undefined)
          leaving.set(previous.parentId, (held = new Map<ObjectId, StackedObject>()));
        held.set(previous.id, previous);
      }
      if (next !== undefined) {
        let objects = arriving.get(next.parentId);
        if (objects === undefined) arriving.set(next.parentId, (objects = []));
        objects.push(next);
      }
    }
    for (const [parentId, held] of leaving) this.removeAll(parentId, held);
    for (const [parentId, objects] of arriving) {
      objects.sort(compareStacking);
      const merged = mergeSorted(this.childrenByParent.get(parentId) ?? [], objects);
      this.childrenByParent.set(parentId, merged);
      for (const object of objects) this.ids.add(object.id);
    }
  }

  /**
   * Removes several objects from one parent's list in one pass.
   *
   * @param parentId - The parent.
   * @param held - The objects as the lists hold them, by id, each in that parent's list.
   * @throws {Error} When one is not there, or is there under another z key.
   */
  private removeAll(parentId: ObjectId | null, held: ReadonlyMap<ObjectId, StackedObject>): void {
    const siblings = this.childrenByParent.get(parentId) ?? [];
    const found = new Set<ObjectId>();
    const kept = siblings.filter((sibling) => {
      const previous = held.get(sibling.id);
      if (previous === undefined || compareStacking(previous, sibling) !== 0) return true;
      found.add(sibling.id);
      return false;
    });
    const missing = [...held.keys()].find((id) => !found.has(id));
    if (missing !== undefined) {
      throw new Error(`Sibling lists do not hold "${missing}" where its z key puts it`);
    }
    if (kept.length === 0) this.childrenByParent.delete(parentId);
    else this.childrenByParent.set(parentId, kept);
    for (const id of found) this.ids.delete(id);
  }

  /**
   * Removes one object from its parent's list.
   *
   * @param object - The object as the lists hold it.
   * @throws {Error} When it is not there.
   */
  private remove(object: StackedObject): void {
    const siblings = this.childrenByParent.get(object.parentId);
    const index = siblings === undefined ? -1 : insertionIndex(siblings, object);
    if (siblings?.[index]?.id !== object.id) {
      throw new Error(`Sibling lists do not hold "${object.id}" where its z key puts it`);
    }
    siblings.splice(index, 1);
    if (siblings.length === 0) this.childrenByParent.delete(object.parentId);
    this.ids.delete(object.id);
  }

  /**
   * A parent's mutable list, created empty when missing.
   *
   * @param parentId - The parent's id, or null.
   * @returns The list.
   */
  private listOf(parentId: ObjectId | null): StackedObject[] {
    let siblings = this.childrenByParent.get(parentId);
    if (siblings === undefined) {
      siblings = [];
      this.childrenByParent.set(parentId, siblings);
    }
    return siblings;
  }
}

/**
 * Whether a change set's one restack keeps its object's place: a stroke committed takes
 * a real z key in place of its preview's, often beside the next stroke's preview arriving. One
 * restack is judged when every other move is an arrival or a departure (judged at the end of the
 * order itself): neither reorders the objects already there; another restack could change its
 * neighbours.
 *
 * @param lists - The sibling lists, before the change set.
 * @param restacked - The objects whose z key changed under the same parent, before and after.
 * @param moves - Every move of the change set.
 * @returns Whether there is one restack and it keeps its place (`SiblingLists.keepsPlace`).
 */
export function isLonePlaceKept(
  lists: SiblingLists,
  restacked: readonly (readonly [StackedObject, StackedObject])[],
  moves: readonly SiblingChange[],
): boolean {
  const [from, to] = restacked[0] ?? [];
  return (
    restacked.length === 1 &&
    moves.every(
      ([previous, next]) => previous === undefined || next === undefined || previous === from,
    ) &&
    from !== undefined &&
    to !== undefined &&
    lists.keepsPlace(from, to)
  );
}

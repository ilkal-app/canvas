import type { ObjectId } from '@canvas/schema';

/**
 * Every mirrored object's parent and, per parent, its children: what the spatial index walks to
 * re-index a changed object's descendants. Main thread or the engine worker.
 */
export class ParentLinks {
  private readonly parentById = new Map<ObjectId, ObjectId | null>();
  private readonly childrenByParent = new Map<ObjectId, Set<ObjectId>>();

  /**
   * An object's recorded parent.
   *
   * @param id - The object.
   * @returns Its parent id, null at the root, or undefined when it is not recorded.
   */
  parentOf(id: ObjectId): ObjectId | null | undefined {
    return this.parentById.get(id);
  }

  /**
   * Whether an object has recorded children.
   *
   * @param id - The object.
   * @returns True when it has.
   */
  hasChildren(id: ObjectId): boolean {
    return this.childrenByParent.has(id);
  }

  /**
   * The ids and all their descendants, each once. The child index is walked after the touched
   * objects' parents are recorded, so a deleted object's former children are still found.
   *
   * @param ids - The starting ids, owned by the caller; extended in place.
   * @returns The ids, then descendants.
   */
  withDescendants(ids: Set<ObjectId>): Set<ObjectId> {
    // The caller owns this set. Only objects with children need a traversal frontier.
    let pending: ObjectId[] | undefined;
    for (const id of ids) {
      if (this.childrenByParent.has(id)) (pending ??= []).push(id);
    }
    if (pending === undefined) return ids;
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const children = this.childrenByParent.get(id);
      if (children === undefined) continue;
      for (const child of children) {
        if (ids.has(child)) continue;
        ids.add(child);
        if (this.childrenByParent.has(child)) pending.push(child);
      }
    }
    return ids;
  }

  /**
   * Records an object's parent, moving it between parents in the child index, or forgets the
   * object when it is gone. A removed object's own children stay listed under it, so their
   * refresh re-roots them.
   *
   * @param id - The object id.
   * @param parentId - Its parent now, null at the root, or `undefined` when it was deleted.
   */
  set(id: ObjectId, parentId: ObjectId | null | undefined): void {
    const previous = this.parentById.get(id) ?? null;
    if (parentId === undefined) {
      this.parentById.delete(id);
    } else {
      this.parentById.set(id, parentId);
    }
    const next = parentId ?? null;
    if (previous === next) return;
    if (previous !== null) {
      const siblings = this.childrenByParent.get(previous);
      siblings?.delete(id);
      if (siblings?.size === 0) this.childrenByParent.delete(previous);
    }
    if (next !== null) {
      const siblings = this.childrenByParent.get(next) ?? new Set();
      siblings.add(id);
      this.childrenByParent.set(next, siblings);
    }
  }
}

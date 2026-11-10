import type { ObjectId } from '@canvas/schema';

const NO_CHILDREN: ReadonlySet<ObjectId> = new Set();

/**
 * The parent tree of the objects a scene mirrors, drawn or not: each object's parent and each
 * parent's children, as the scene last applied them. The scene keeps it to refresh descendants;
 * connector routing reads it to find what a moved group or frame carries.
 */
export class SceneHierarchy {
  private readonly parentById = new Map<ObjectId, ObjectId | null>();
  private readonly childrenByParent = new Map<ObjectId, Set<ObjectId>>();

  /**
   * The number of objects held.
   *
   * @returns The count.
   */
  get size(): number {
    return this.parentById.size;
  }

  /**
   * Whether any object has a child.
   *
   * @returns True when some object is a parent.
   */
  get hasParents(): boolean {
    return this.childrenByParent.size > 0;
  }

  /**
   * Whether the hierarchy holds an object.
   *
   * @param id - The object.
   * @returns True when it was set and not removed.
   */
  has(id: ObjectId): boolean {
    return this.parentById.has(id);
  }

  /**
   * An object's parent.
   *
   * @param id - The object.
   * @returns The parent's id; null at the root or for an object not held.
   */
  parentOf(id: ObjectId): ObjectId | null {
    return this.parentById.get(id) ?? null;
  }

  /**
   * Whether an object is a root leaf: present, at the root, with no children. What a retained move
   * checks its members against (moved here from `Scene`).
   *
   * @param id - The object.
   * @returns True when it is.
   */
  isRootLeaf(id: ObjectId): boolean {
    return this.has(id) && this.parentOf(id) === null && this.childrenOf(id).size === 0;
  }

  /**
   * An object's children.
   *
   * @param id - The object.
   * @returns Their ids; empty for none. Live: it changes as the scene applies changes.
   */
  childrenOf(id: ObjectId): ReadonlySet<ObjectId> {
    return this.childrenByParent.get(id) ?? NO_CHILDREN;
  }

  /**
   * Visits an object's descendants depth-first, skipping those already visited. Each one's
   * children are read after it is visited, since visiting (the scene's refresh) may re-parent.
   *
   * @param id - The object.
   * @param visited - The objects to skip; the visitor adds to it.
   * @param visit - Called for each descendant not yet visited.
   */
  visitDescendants(
    id: ObjectId,
    visited: ReadonlySet<ObjectId>,
    visit: (id: ObjectId) => void,
  ): void {
    const pending = [...this.childrenOf(id)];
    for (let childId = pending.pop(); childId !== undefined; childId = pending.pop()) {
      if (visited.has(childId)) continue;
      visit(childId);
      pending.push(...this.childrenOf(childId));
    }
  }

  /**
   * Records an object's parent, moving it between parents' children.
   *
   * @param id - The object.
   * @param parentId - Its parent now, or null at the root.
   */
  setParent(id: ObjectId, parentId: ObjectId | null): void {
    const previous = this.parentById.get(id) ?? null;
    this.parentById.set(id, parentId);
    if (previous === parentId) return;
    if (previous !== null) {
      const siblings = this.childrenByParent.get(previous);
      siblings?.delete(id);
      if (siblings?.size === 0) this.childrenByParent.delete(previous);
    }
    if (parentId !== null) {
      let siblings = this.childrenByParent.get(parentId);
      if (!siblings) {
        siblings = new Set();
        this.childrenByParent.set(parentId, siblings);
      }
      siblings.add(id);
    }
  }

  /**
   * Forgets an object: it leaves its parent's children. Its own children keep it as their
   * parent until they are set or removed themselves.
   *
   * @param id - The object.
   */
  remove(id: ObjectId): void {
    this.setParent(id, null);
    this.parentById.delete(id);
  }
}

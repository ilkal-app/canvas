import { compareSiblings, type BoardObject, type ObjectId, type SiblingKey } from '@canvas/schema';

/**
 * Read-only reverse indexes over the board, for the command layer: the schema's rules
 * (`cascadeDelete`, `detachConnectorsFrom`, ...) rebuild these on every call, which is O(n)
 * per command on a 50k-object board; the store keeps them up to date from each transaction's
 * changes instead. A returned set is never modified afterwards (a later change replaces it), so
 * it is safe to keep; it reflects the board as of the last completed transaction. Ids of
 * missing objects are indexed too (a child of a deleted parent is still found under it).
 */
export interface BoardReferences {
  /**
   * Finds stored instances of a main, including instances of a retired definition.
   *
   * @param mainId - The definition id.
   * @returns The referring instance ids.
   */
  instancesOf(mainId: ObjectId): ReadonlySet<ObjectId>;
  /**
   * The objects whose `parentId` is `parentId`, in no order (stacking is by `z`).
   *
   * @param parentId - A group or frame id, or `null` for the board root.
   * @returns The child ids; empty when there are none.
   */
  childrenOf(parentId: ObjectId | null): ReadonlySet<ObjectId>;
  /**
   * The child on top of a parent's stack: the greatest `z`, ties broken by the greater id (the
   * order of `sortedSiblings`). Kept up to date as objects are written, so it is O(1) while the
   * top only rises (creating objects at the front); after the top child is moved down or away,
   * the next query rescans that parent's children once.
   *
   * @param parentId - A group or frame id, or `null` for the board root.
   * @returns The top child's id, or `undefined` when the parent has no readable children.
   */
  topChildOf(parentId: ObjectId | null): ObjectId | undefined;
  /**
   * The connectors with either end attached to an object.
   *
   * @param objectId - The target object id.
   * @returns The connector ids; empty when there are none.
   */
  connectorsAttachedTo(objectId: ObjectId): ReadonlySet<ObjectId>;
  /**
   * The comments pinned to an object.
   *
   * @param objectId - The anchor object id.
   * @returns The comment ids; empty when there are none.
   */
  commentsAnchoredTo(objectId: ObjectId): ReadonlySet<ObjectId>;
}

/** An object's state before and after a transaction; `undefined` where it did not exist. */
export interface ObjectReplacement {
  /** The object before, or `undefined` when it was created. */
  readonly previous: BoardObject | undefined;
  /** The object after, or `undefined` when it was deleted or cannot be read. */
  readonly next: BoardObject | undefined;
}

const EMPTY: ReadonlySet<ObjectId> = new Set();

/**
 * Sets of ids keyed by a reference, copied on first write within a batch so that sets handed
 * out earlier never change.
 */
class SetIndex<Key> {
  readonly #sets = new Map<Key, Set<ObjectId>>();
  readonly #ownedInBatch = new Set<Key>();

  /**
   * The ids under a key.
   *
   * @param key - The reference.
   * @returns The ids; the shared empty set when there are none.
   */
  get(key: Key): ReadonlySet<ObjectId> {
    return this.#sets.get(key) ?? EMPTY;
  }

  /**
   * The set under a key that this batch may modify, copying the published one first.
   *
   * @param key - The reference.
   * @returns The writable set.
   */
  #writable(key: Key): Set<ObjectId> {
    const published = this.#sets.get(key);
    if (published !== undefined && this.#ownedInBatch.has(key)) return published;
    const owned = new Set(published);
    this.#sets.set(key, owned);
    this.#ownedInBatch.add(key);
    return owned;
  }

  /**
   * Adds an id under a key.
   *
   * @param key - The reference.
   * @param id - The referring object.
   */
  add(key: Key, id: ObjectId): void {
    this.#writable(key).add(id);
  }

  /**
   * Removes an id from under a key, dropping the key when nothing is left.
   *
   * @param key - The reference.
   * @param id - The referring object.
   */
  remove(key: Key, id: ObjectId): void {
    if (!this.#sets.get(key)?.has(id)) return;
    const set = this.#writable(key);
    set.delete(id);
    if (set.size === 0) this.#sets.delete(key);
  }

  /** Ends a batch: every set is published and must be copied before its next change. */
  endBatch(): void {
    this.#ownedInBatch.clear();
  }
}

/**
 * The ids an object's connector ends are attached to.
 *
 * @param object - The object.
 * @returns The target ids, possibly with a repeat; empty for anything but a connector.
 */
function connectorTargetsOf(object: BoardObject): ObjectId[] {
  if (object.type !== 'connector') return [];
  const targets: ObjectId[] = [];
  if (object.from.kind === 'object') targets.push(object.from.objectId);
  if (object.to.kind === 'object') targets.push(object.to.objectId);
  return targets;
}

/**
 * The id a comment is pinned to.
 *
 * @param object - The object.
 * @returns The anchor id, or `undefined` for a point pin or anything but a comment.
 */
function commentAnchorOf(object: BoardObject): ObjectId | undefined {
  return object.type === 'comment' && object.anchor.kind === 'object'
    ? object.anchor.objectId
    : undefined;
}

/**
 * The reverse indexes of {@link BoardReferences}, updated from the objects each transaction
 * replaced. Work per transaction is proportional to what changed (plus copying each touched
 * set once), never to the board size.
 */
export class ReferenceIndex implements BoardReferences {
  readonly #children = new SetIndex<ObjectId | null>();
  readonly #connectors = new SetIndex<ObjectId>();
  readonly #instances = new SetIndex<ObjectId>();
  readonly #comments = new SetIndex<ObjectId>();
  /** The key of every indexed object, for finding a parent's top child. */
  readonly #keys = new Map<ObjectId, SiblingKey>();
  /** Each parent's top child once known (`null`: no children); absent means unknown. */
  readonly #tops = new Map<ObjectId | null, ObjectId | null>();

  /** @inheritdoc */
  instancesOf(mainId: ObjectId): ReadonlySet<ObjectId> {
    return this.#instances.get(mainId);
  }

  /** @inheritdoc */
  childrenOf(parentId: ObjectId | null): ReadonlySet<ObjectId> {
    return this.#children.get(parentId);
  }

  /** @inheritdoc */
  topChildOf(parentId: ObjectId | null): ObjectId | undefined {
    let top = this.#tops.get(parentId);
    if (top === undefined) {
      let highest: SiblingKey | undefined;
      for (const id of this.#children.get(parentId)) {
        const key = this.#keys.get(id);
        if (key !== undefined && (highest === undefined || compareSiblings(key, highest) > 0)) {
          highest = key;
        }
      }
      top = highest?.id ?? null;
      this.#tops.set(parentId, top);
    }
    return top ?? undefined;
  }

  /** @inheritdoc */
  connectorsAttachedTo(objectId: ObjectId): ReadonlySet<ObjectId> {
    return this.#connectors.get(objectId);
  }

  /** @inheritdoc */
  commentsAnchoredTo(objectId: ObjectId): ReadonlySet<ObjectId> {
    return this.#comments.get(objectId);
  }

  /**
   * Moves each replaced object's references from its previous state to its next one, as one
   * batch: sets handed out before this call are left unchanged.
   *
   * @param replacements - The objects one transaction (or several) changed.
   */
  apply(replacements: Iterable<ObjectReplacement>): void {
    for (const { previous, next } of replacements) {
      if (previous !== undefined) this.#unindex(previous);
      if (next !== undefined) this.#index(next);
    }
    this.#children.endBatch();
    this.#connectors.endBatch();
    this.#comments.endBatch();
    this.#instances.endBatch();
  }

  /**
   * Adds an object's references.
   *
   * @param object - The object.
   */
  #index(object: BoardObject): void {
    this.#children.add(object.parentId, object.id);
    if (object.type === 'instance') this.#instances.add(object.mainId, object.id);
    const key: SiblingKey = { id: object.id, z: object.z };
    this.#keys.set(object.id, key);
    const top = this.#tops.get(object.parentId);
    const topKey = top === undefined || top === null ? undefined : this.#keys.get(top);
    if (top === null || (topKey !== undefined && compareSiblings(key, topKey) > 0)) {
      this.#tops.set(object.parentId, object.id);
    }
    for (const target of connectorTargetsOf(object)) this.#connectors.add(target, object.id);
    const anchor = commentAnchorOf(object);
    if (anchor !== undefined) this.#comments.add(anchor, object.id);
  }

  /**
   * Removes an object's references.
   *
   * @param object - The object as it was indexed.
   */
  #unindex(object: BoardObject): void {
    this.#children.remove(object.parentId, object.id);
    if (object.type === 'instance') this.#instances.remove(object.mainId, object.id);
    this.#keys.delete(object.id);
    if (this.#tops.get(object.parentId) === object.id) this.#tops.delete(object.parentId);
    for (const target of connectorTargetsOf(object)) this.#connectors.remove(target, object.id);
    const anchor = commentAnchorOf(object);
    if (anchor !== undefined) this.#comments.remove(anchor, object.id);
  }
}

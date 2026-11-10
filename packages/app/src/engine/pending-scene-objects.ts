import type { ObjectId } from '@canvas/schema';

/** How an object not yet sent will reach the renderer: new to it, or over a cached preview's. */
type PendingKind = 'created' | 'updated';

/** Objects for one change set: those the renderer lacks, and those a cached preview drew. */
export interface PendingTake {
  /** Objects new to the renderer, each after its ancestors. */
  readonly created: ObjectId[];
  /** Objects a cached preview drew, which the renderer has. */
  readonly updated: ObjectId[];
}

/** A document change set's ids, as `DocumentSceneFeed` hands them to the renderer. */
export interface RoutedChanges extends PendingTake {
  /** Objects to remove from the renderer. */
  readonly deleted: ObjectId[];
}

/** A change's ids by how they changed. */
type ChangeIds = Readonly<Record<keyof RoutedChanges, readonly ObjectId[]>>;

/**
 * What a sliced attach still owes the renderer: the document's objects not yet sent,
 * in document order, each as created or, when a cached preview already drew it, updated. Every
 * take is ancestor-closed: an object goes with those of its ancestors still owed, root first, so
 * the renderer never places a child before its parent. Main thread.
 */
export class PendingSceneObjects {
  #kinds = new Map<ObjectId, PendingKind>();

  /**
   * Owes every object of the document.
   *
   * @param ids - The document's objects, in document order.
   * @param previous - Objects a cached preview already drew.
   */
  constructor(ids: Iterable<ObjectId>, previous: ReadonlySet<ObjectId>) {
    for (const id of ids) this.#kinds.set(id, previous.has(id) ? 'updated' : 'created');
  }

  /**
   * How many objects are still owed.
   *
   * @returns The count.
   */
  get size(): number {
    return this.#kinds.size;
  }

  /**
   * Moves these objects, where still owed, ahead of the rest, keeping document order on both
   * sides: what the camera shows goes first.
   *
   * @param ids - The objects, in any order.
   * @returns How many of them are owed, now first.
   */
  prioritize(ids: Iterable<ObjectId>): number {
    const first = new Set(ids);
    const ahead = new Map<ObjectId, PendingKind>();
    const behind = new Map<ObjectId, PendingKind>();
    for (const [id, kind] of this.#kinds) (first.has(id) ? ahead : behind).set(id, kind);
    this.#kinds = new Map([...ahead, ...behind]);
    return ahead.size;
  }

  /**
   * Takes the given objects still owed, with their owed ancestors; ids not owed are skipped.
   *
   * @param ids - The objects.
   * @param parentOf - An object's parent, null at the root or for one the document lacks.
   * @returns What to send.
   */
  take(ids: Iterable<ObjectId>, parentOf: (id: ObjectId) => ObjectId | null): PendingTake {
    const taken: PendingTake = { created: [], updated: [] };
    for (const id of ids) this.#takeWithAncestors(id, parentOf, taken);
    return taken;
  }

  /**
   * Takes the next objects owed in document order, with their owed ancestors.
   *
   * @param count - How many to take, before ancestors.
   * @param parentOf - An object's parent, null at the root or for one the document lacks.
   * @returns What to send.
   */
  takeNext(count: number, parentOf: (id: ObjectId) => ObjectId | null): PendingTake {
    const next: ObjectId[] = [];
    for (const id of this.#kinds.keys()) {
      if (next.length === count) break;
      next.push(id);
    }
    return this.take(next, parentOf);
  }

  /**
   * Routes a document change while objects are owed: a changed object still owed goes now, as
   * it is owed, with its owed ancestors, and is owed no more; a deleted one still owed is owed no
   * more, and is deleted from the renderer only if a cached preview drew it.
   *
   * @param changes - What changed, as the feed would send it.
   * @param parentOf - An object's parent, null at the root or for one the document lacks.
   * @returns What to send instead.
   */
  route(changes: ChangeIds, parentOf: (id: ObjectId) => ObjectId | null): RoutedChanges {
    const routed: RoutedChanges = { created: [], updated: [], deleted: [] };
    // Owed or not, a changed object goes after its owed ancestors: it may be new, or moved,
    // under an object not yet sent.
    const sent = (id: ObjectId, list: ObjectId[]): void => {
      const isOwed = this.#kinds.has(id);
      this.#takeWithAncestors(id, parentOf, routed);
      if (!isOwed) list.push(id);
    };
    for (const id of changes.created) sent(id, routed.created);
    for (const id of changes.updated) sent(id, routed.updated);
    for (const id of changes.deleted) {
      const kind = this.#kinds.get(id);
      this.#kinds.delete(id);
      if (kind !== 'created') routed.deleted.push(id);
    }
    return routed;
  }

  /**
   * Takes an object, if owed, after those of its ancestors still owed, root first. Walks the
   * whole parent chain (a sent object may now sit under an owed one), once per object.
   *
   * @param id - The object.
   * @param parentOf - An object's parent, null at the root or for one the document lacks.
   * @param into - Where the taken objects go, by how they are owed.
   */
  #takeWithAncestors(
    id: ObjectId,
    parentOf: (id: ObjectId) => ObjectId | null,
    into: PendingTake,
  ): void {
    const chain: ObjectId[] = [];
    const seen = new Set<ObjectId>();
    for (let at: ObjectId | null = id; at !== null && !seen.has(at); at = parentOf(at)) {
      seen.add(at);
      chain.push(at);
    }
    for (const owed of chain.reverse()) {
      const kind = this.#kinds.get(owed);
      if (kind === undefined) continue;
      this.#kinds.delete(owed);
      into[kind].push(owed);
    }
  }
}

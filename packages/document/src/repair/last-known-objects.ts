import type { BoardObject, ObjectId } from '@canvas/schema';

/**
 * How many removed objects a store remembers. A remote change can refer to an object this
 * client removed long before (a peer created a child in a frame this client deleted, while the
 * two were apart), so the memory is of every removal, not only of objects something refers to
 * when they go; about 4k frozen objects, the ones the store already decoded, a few MiB at most.
 *
 * Beyond the bound, what survives can differ between clients: when one removal batch is larger
 * than the capacity, which of its objects are kept follows the order its keys were marked in,
 * which is the order of Yjs's events on that client; and clients flush in different batches.
 * Two clients can then repair the same reference from different last-known states (one of them
 * falling back to no geometry). The CRDT still keeps one value per field and the result is
 * valid; only "where it was" may differ from what one client saw.
 */
export const LAST_KNOWN_CAPACITY = 4096;

/** A remembered object and the batch it was removed in. */
interface Entry {
  /** The object as it was last seen on the board. */
  readonly object: BoardObject;
  /** Which {@link LastKnownObjects.recordRemoved} call recorded it. */
  readonly batch: number;
}

/**
 * The last state of objects that left the board, newest last, bounded by a capacity: the
 * geometry the reference repair needs when something still refers to a removed object (a
 * connector end or a comment pin becomes a point where its target was, a child
 * keeps its place on the board). Change sets carry only ids, and Yjs keeps no readable value
 * of a deleted object, so the store records each object as its decoded cache last held it.
 * Single-threaded; one per store.
 */
export class LastKnownObjects {
  readonly #capacity: number;
  /** Insertion order is age: the first entry is the oldest. */
  readonly #entries = new Map<ObjectId, Entry>();
  /** Remembered objects by their remembered parent. */
  readonly #children = new Map<ObjectId, Set<ObjectId>>();
  #batch = 0;

  /**
   * Creates an empty memory.
   *
   * @param capacity - How many objects to keep; the oldest are dropped beyond it.
   * @throws {RangeError} When `capacity` is not a positive integer.
   */
  constructor(capacity = LAST_KNOWN_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A capacity is a positive integer, got ${String(capacity)}`);
    }
    this.#capacity = capacity;
  }

  /**
   * How many objects are remembered.
   *
   * @returns The count, at most the capacity.
   */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Remembers objects that were removed together (one decoded batch of the store's cache), as
   * the newest entries.
   *
   * @param objects - The objects as they were last seen.
   */
  recordRemoved(objects: readonly BoardObject[]): void {
    if (objects.length === 0) return;
    this.#batch += 1;
    for (const object of objects) {
      this.forget(object.id);
      this.#entries.set(object.id, { object, batch: this.#batch });
      if (object.parentId !== null) {
        const siblings = this.#children.get(object.parentId) ?? new Set<ObjectId>();
        siblings.add(object.id);
        this.#children.set(object.parentId, siblings);
      }
    }
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#capacity) break;
      this.forget(oldest);
    }
  }

  /**
   * Forgets an object, because it is back on the board or too old.
   *
   * @param id - The object id; nothing happens when it is not remembered.
   */
  forget(id: ObjectId): void {
    const entry = this.#entries.get(id);
    if (entry === undefined) return;
    this.#entries.delete(id);
    const parentId = entry.object.parentId;
    if (parentId === null) return;
    const siblings = this.#children.get(parentId);
    siblings?.delete(id);
    if (siblings?.size === 0) this.#children.delete(parentId);
  }

  /**
   * A removed object as it was last seen.
   *
   * @param id - The object id.
   * @returns The object, or `undefined` when it is not remembered.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.#entries.get(id)?.object;
  }

  /**
   * The remembered children of a remembered parent that were removed together with it, so a
   * removed group's derived bounds are measured over the children it had when it went, not
   * over children removed from it earlier.
   *
   * @param parentId - The parent's id.
   * @returns The children's ids, oldest first; empty when the parent is not remembered.
   */
  childrenOf(parentId: ObjectId): ObjectId[] {
    const parent = this.#entries.get(parentId);
    if (parent === undefined) return [];
    return [...(this.#children.get(parentId) ?? [])].filter(
      (childId) => this.#entries.get(childId)?.batch === parent.batch,
    );
  }
}

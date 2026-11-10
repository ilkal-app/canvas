import type { ObjectId } from '@canvas/schema';

/**
 * Each object's paint rank, keyed so an edit in the middle of the paint order costs a typed-array
 * pass rather than a write per shifted object: an object keeps a handle for as long as
 * it is indexed, and its rank sits in an `Int32Array` at that handle, so shifting every rank past
 * an inserted or removed one (`remap`) is a loop over numbers, not 50k map writes. Reads as a
 * `ReadonlyMap`, so the tables built from ranks take it as they took a map.
 */
export class RankIndex implements ReadonlyMap<ObjectId, number> {
  private readonly handleById = new Map<ObjectId, number>();
  /** Per handle, its object; `undefined` for a free handle. */
  private readonly idOfHandle: (ObjectId | undefined)[] = [];
  /** Per handle, its rank; meaningless for a free handle. */
  private rankOfHandle = new Int32Array(16);
  private readonly freeHandles: number[] = [];

  /**
   * How many objects are indexed.
   *
   * @returns The count.
   */
  get size(): number {
    return this.handleById.size;
  }

  /**
   * An object's rank.
   *
   * @param id - The object.
   * @returns Its rank, or `undefined` when it is not indexed.
   */
  get(id: ObjectId): number | undefined {
    const handle = this.handleById.get(id);
    return handle === undefined ? undefined : this.rankOfHandle[handle];
  }

  /**
   * Whether an object is indexed.
   *
   * @param id - The object.
   * @returns True when it is.
   */
  has(id: ObjectId): boolean {
    return this.handleById.has(id);
  }

  /**
   * Indexes an object at a rank, or moves it there.
   *
   * @param id - The object.
   * @param rank - Its rank.
   * @returns This index.
   */
  set(id: ObjectId, rank: number): this {
    let handle = this.handleById.get(id);
    if (handle === undefined) {
      handle = this.freeHandles.pop() ?? this.idOfHandle.length;
      if (handle >= this.rankOfHandle.length) {
        const grown = new Int32Array(2 * this.rankOfHandle.length);
        grown.set(this.rankOfHandle);
        this.rankOfHandle = grown;
      }
      this.idOfHandle[handle] = id;
      this.handleById.set(id, handle);
    }
    this.rankOfHandle[handle] = rank;
    return this;
  }

  /**
   * Stops indexing an object; its handle is reused.
   *
   * @param id - The object.
   * @returns Whether it was indexed.
   */
  delete(id: ObjectId): boolean {
    const handle = this.handleById.get(id);
    if (handle === undefined) return false;
    this.handleById.delete(id);
    this.idOfHandle[handle] = undefined;
    this.freeHandles.push(handle);
    return true;
  }

  /**
   * Moves every indexed rank through a shift, in one pass over the ranks: the order's ranks after
   * an edit (`RankShift.newRanks`). The shift must keep every indexed object (none maps to -1).
   *
   * @param newRanks - Per old rank, its new rank.
   * @param firstMoved - The lowest rank the edit moved (`RankShift.firstMoved`); lower ranks stay.
   */
  remap(newRanks: Int32Array, firstMoved = 0): void {
    const ranks = this.rankOfHandle;
    const ids = this.idOfHandle;
    for (let handle = 0; handle < ids.length; handle += 1) {
      const rank = ranks[handle] ?? 0;
      if (rank >= firstMoved && ids[handle] !== undefined) ranks[handle] = newRanks[rank] ?? -1;
    }
  }

  /**
   * Calls a function for each indexed object, as `Map.forEach` does.
   *
   * @param callback - Called with each rank, its object and this index.
   */
  forEach(
    callback: (rank: number, id: ObjectId, index: ReadonlyMap<ObjectId, number>) => void,
  ): void {
    for (const [id, rank] of this) callback(rank, id, this);
  }

  /**
   * Each indexed object with its rank.
   *
   * @yields {[ObjectId, number]} The object and its rank.
   */
  *entries(): MapIterator<[ObjectId, number]> {
    for (const [id, handle] of this.handleById) yield [id, this.rankOfHandle[handle] ?? 0];
  }

  /**
   * Each indexed object.
   *
   * @returns The objects.
   */
  keys(): MapIterator<ObjectId> {
    return this.handleById.keys();
  }

  /**
   * Each indexed rank.
   *
   * @yields {number} A rank.
   */
  *values(): MapIterator<number> {
    for (const handle of this.handleById.values()) yield this.rankOfHandle[handle] ?? 0;
  }

  /**
   * Each indexed object with its rank.
   *
   * @returns The entries.
   */
  [Symbol.iterator](): MapIterator<[ObjectId, number]> {
    return this.entries();
  }
}

/**
 * A fixed-capacity ring of reusable slots, oldest first: the frame history the stage timers
 * write into. Every slot is created up front and
 * rewritten in place, so recording a frame allocates nothing. A writer fills the slot
 * {@link RingBuffer.acquire} hands out and then calls {@link RingBuffer.commit}; until then the
 * slot is not part of the history, so a frame abandoned half-way leaves no partial entry. One
 * slot more than the capacity is kept, so the acquired slot is never a committed entry.
 * Single-threaded: owned by the thread that runs the frame.
 */
export class RingBuffer<T> {
  private readonly slots: readonly T[];
  /** Index of the oldest committed slot. */
  private start = 0;
  private count = 0;

  /**
   * Creates the ring and all of its slots.
   *
   * @param capacity - How many entries the ring keeps; the oldest is overwritten past it.
   * @param createSlot - Builds one empty slot; called `capacity + 1` times, here only.
   * @throws {RangeError} When the capacity is not a positive integer.
   */
  constructor(capacity: number, createSlot: () => T) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A ring capacity is a positive integer; received ${String(capacity)}.`);
    }
    this.slots = Array.from({ length: capacity + 1 }, createSlot);
  }

  /**
   * How many entries the ring can hold.
   *
   * @returns The capacity.
   */
  get capacity(): number {
    return this.slots.length - 1;
  }

  /**
   * How many committed entries the ring holds, at most its capacity.
   *
   * @returns The entry count.
   */
  get size(): number {
    return this.count;
  }

  /**
   * The most recently committed entry.
   *
   * @returns The entry, or `undefined` when the ring is empty.
   */
  get newest(): T | undefined {
    return this.count === 0 ? undefined : this.at(this.count - 1);
  }

  /**
   * An entry by age.
   *
   * @param index - 0 for the oldest committed entry, `size - 1` for the newest.
   * @returns The entry.
   * @throws {RangeError} When the index is outside `[0, size)`.
   */
  at(index: number): T {
    const slot =
      Number.isInteger(index) && index >= 0 && index < this.count
        ? this.slots[(this.start + index) % this.slots.length]
        : undefined;
    if (slot === undefined) {
      throw new RangeError(`No entry ${String(index)} in a ring of ${String(this.count)}.`);
    }
    return slot;
  }

  /**
   * The slot the next {@link RingBuffer.commit} adds, never one of the committed entries. Calling
   * it again before committing returns the same slot.
   *
   * @returns The slot to fill; it still holds whatever it held last.
   */
  acquire(): T {
    return this.slots[(this.start + this.count) % this.slots.length] as T;
  }

  /** Adds the acquired slot as the newest entry, dropping the oldest when the ring is full. */
  commit(): void {
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.slots.length;
    }
  }

  /** Forgets every entry; the slots are kept for reuse. */
  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}

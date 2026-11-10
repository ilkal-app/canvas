import { coalesceDirtyRecords, type ByteRange } from './dirty-ranges.js';
import type { InstanceLayout } from './instance-layout.js';

/** Options for an {@link InstanceBuffer}. */
export interface InstanceBufferOptions {
  /** Records the buffer holds before it first grows. Default 64. */
  readonly initialCapacity?: number;
  /**
   * The widest run of clean bytes a dirty range may bridge when ranges are coalesced
   * (see `coalesceDirtyRecords`). Default 256.
   */
  readonly maxGapBytes?: number;
}

const DEFAULT_INITIAL_CAPACITY = 64;
const DEFAULT_MAX_GAP_BYTES = 256;

/**
 * The CPU copy of one pass's persistent instance buffer (so most frames
 * upload nothing). Records have a fixed stride from the pass's {@link InstanceLayout} and live
 * in slots: a slot is allocated when an object gains a record and released when it loses it,
 * and released slots are reused before the buffer grows. The buffer grows by doubling.
 *
 * Every write that changes a record marks its slot dirty; {@link InstanceBuffer.dirtyRanges}
 * coalesces the dirty slots into the byte ranges to upload, and the upload stage clears them.
 * A released record is zeroed, which draws nothing (a zero-size instance), so the draw range
 * can stay `[0, recordCount)` with holes in it.
 */
export class InstanceBuffer {
  /** The layout every record follows. */
  readonly layout: InstanceLayout;
  private readonly maxGapBytes: number;
  private records: Float32Array<ArrayBuffer>;
  private isAllocatedBySlot: Uint8Array;
  private isDirtyBySlot: Uint8Array;
  private readonly dirtySlots: number[] = [];
  private readonly freeSlots: number[] = [];
  private highWaterMark = 0;
  private cachedRanges: ByteRange[] | undefined;

  /**
   * Creates an empty buffer.
   *
   * @param layout - The record layout.
   * @param options - Initial capacity and range coalescing.
   * @throws {RangeError} When the initial capacity is not a positive integer.
   */
  constructor(layout: InstanceLayout, options: InstanceBufferOptions = {}) {
    const capacity = options.initialCapacity ?? DEFAULT_INITIAL_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `initialCapacity must be a positive integer; received ${String(capacity)}.`,
      );
    }
    this.layout = layout;
    this.maxGapBytes = options.maxGapBytes ?? DEFAULT_MAX_GAP_BYTES;
    this.records = new Float32Array(capacity * layout.floatsPerRecord);
    this.isAllocatedBySlot = new Uint8Array(capacity);
    this.isDirtyBySlot = new Uint8Array(capacity);
  }

  /**
   * The records' backing store, `capacity × floatsPerRecord` floats. Replaced when the buffer
   * grows, so read it again after any `allocate`.
   *
   * @returns The whole store, including unallocated slots (zeros).
   */
  get data(): Float32Array<ArrayBuffer> {
    return this.records;
  }

  /**
   * How many records the buffer can hold before it grows.
   *
   * @returns The capacity in records.
   */
  get capacity(): number {
    return this.isAllocatedBySlot.length;
  }

  /**
   * The size the GPU copy must have: `capacity × byteStride`.
   *
   * @returns The size in bytes.
   */
  get byteLength(): number {
    return this.records.byteLength;
  }

  /**
   * One past the highest slot ever allocated: records `[0, recordCount)` are the draw range.
   * Released slots inside it are zeroed and draw nothing.
   *
   * @returns The record count.
   */
  get recordCount(): number {
    return this.highWaterMark;
  }

  /**
   * How many slots are allocated now.
   *
   * @returns The live record count.
   */
  get liveCount(): number {
    return this.highWaterMark - this.freeSlots.length;
  }

  /**
   * The byte ranges changed since the last {@link InstanceBuffer.clearDirty}, coalesced:
   * ascending, disjoint, adjacent records merged and small gaps bridged.
   *
   * @returns The ranges to upload; empty when nothing changed.
   */
  get dirtyRanges(): readonly ByteRange[] {
    this.cachedRanges ??= coalesceDirtyRecords(
      this.dirtySlots,
      this.layout.byteStride,
      this.maxGapBytes,
      this.isDirtyBySlot,
    );
    return this.cachedRanges;
  }

  /**
   * Allocates a slot for a new record, reusing the most recently released slot first and
   * doubling the capacity when none is free. The new record reads as zeros.
   *
   * @returns The slot index.
   */
  allocate(): number {
    const slot = this.freeSlots.pop() ?? this.nextSlot();
    this.isAllocatedBySlot[slot] = 1;
    return slot;
  }

  /**
   * Writes a record into an allocated slot and marks it dirty when any value changed.
   *
   * @param slot - An allocated slot.
   * @param values - The record, exactly `floatsPerRecord` floats.
   * @returns Whether the record changed.
   * @throws {RangeError} When the slot is not allocated or the record has the wrong length.
   */
  write(slot: number, values: Float32Array): boolean {
    this.assertAllocated(slot);
    const floats = this.layout.floatsPerRecord;
    if (values.length !== floats) {
      throw new RangeError(
        `A record has ${String(floats)} floats; received ${String(values.length)}.`,
      );
    }
    const offset = slot * floats;
    let isChanged = false;
    for (let index = 0; index < floats; index += 1) {
      if (this.records[offset + index] !== values[index]) {
        isChanged = true;
        break;
      }
    }
    if (isChanged) {
      this.records.set(values, offset);
      this.markDirty(slot);
    }
    return isChanged;
  }

  /**
   * Rewrites a contiguous slice of a retained record, preserving its other fields.
   *
   * @param slot - An allocated slot.
   * @param firstFloat - First float within the record.
   * @param values - Replacement floats, already rounded to float32.
   * @returns Whether any replaced float changed.
   * @throws {RangeError} When the slot is not allocated or the slice leaves its record.
   */
  writePartial(slot: number, firstFloat: number, values: Float32Array): boolean {
    this.assertAllocated(slot);
    const floats = this.layout.floatsPerRecord;
    if (!Number.isInteger(firstFloat) || firstFloat < 0 || firstFloat + values.length > floats)
      throw new RangeError('A partial write must stay inside its record.');
    const offset = slot * floats + firstFloat;
    let isChanged = false;
    for (let index = 0; index < values.length; index += 1) {
      if (this.records[offset + index] === values[index]) continue;
      isChanged = true;
      break;
    }
    if (isChanged) {
      this.records.set(values, offset);
      this.markDirty(slot);
    }
    return isChanged;
  }

  /**
   * Writes one shared slice to a retained prefix of slots, validating its bounds once.
   *
   * @param slots - Allocated slots in record order; duplicates retain sequential semantics.
   * @param count - How many leading slots to update.
   * @param firstFloat - First float within each record.
   * @param values - Replacement floats; aliased slices keep typed-array copy semantics.
   * @returns Number of changed records, counting a repeated slot only when it changes again.
   * @throws {RangeError} For invalid bounds or an unallocated slot; prior slots stay written.
   */
  writePartialMany(
    slots: readonly number[],
    count: number,
    firstFloat: number,
    values: Float32Array,
  ): number {
    if (!Number.isInteger(count) || count < 0 || count > slots.length)
      throw new RangeError('A partial batch must stay inside its slots.');
    if (count === 0) return 0;
    const floats = this.layout.floatsPerRecord;
    if (!Number.isInteger(firstFloat) || firstFloat < 0 || firstFloat + values.length > floats)
      throw new RangeError('A partial write must stay inside its record.');
    let shouldCopy = values.buffer === this.records.buffer;
    // Scalar conversion can quiet a signalling NaN; typed-array set preserves its payload.
    for (const value of values) if (Number.isNaN(value)) shouldCopy = true;
    if (!shouldCopy && values.length === 4) {
      const first = values[0] ?? 0,
        second = values[1] ?? 0,
        third = values[2] ?? 0,
        fourth = values[3] ?? 0;
      let changed = 0;
      for (let index = 0; index < count; index++) {
        const slot = slots[index] ?? -1;
        this.assertAllocated(slot);
        const offset = slot * floats + firstFloat;
        if (
          this.records[offset] === first &&
          this.records[offset + 1] === second &&
          this.records[offset + 2] === third &&
          this.records[offset + 3] === fourth
        )
          continue;
        this.records[offset] = first;
        this.records[offset + 1] = second;
        this.records[offset + 2] = third;
        this.records[offset + 3] = fourth;
        this.markDirty(slot);
        changed++;
      }
      return changed;
    }

    let changed = 0;
    for (let index = 0; index < count; index++) {
      const slot = slots[index] ?? -1;
      this.assertAllocated(slot);
      const offset = slot * floats + firstFloat;
      let isChanged = false;
      for (let component = 0; component < values.length; component++) {
        if (this.records[offset + component] === values[component]) continue;
        isChanged = true;
        break;
      }
      if (!isChanged) continue;
      if (shouldCopy) this.records.set(values, offset);
      else {
        for (let component = 0; component < values.length; component++)
          this.records[offset + component] = values[component] ?? 0;
      }
      this.markDirty(slot);
      changed++;
    }
    return changed;
  }

  /**
   * Releases a slot: zeroes its record, marks it dirty and makes the slot reusable.
   *
   * @param slot - An allocated slot.
   * @throws {RangeError} When the slot is not allocated.
   */
  release(slot: number): void {
    this.assertAllocated(slot);
    const floats = this.layout.floatsPerRecord;
    this.records.fill(0, slot * floats, (slot + 1) * floats);
    this.isAllocatedBySlot[slot] = 0;
    this.freeSlots.push(slot);
    this.markDirty(slot);
  }

  /**
   * Allocates a slot past every slot handed out so far, leaving the free list alone (
   * compaction appends a pass's records in paint order when its low slots are taken). The new
   * record reads as zeros.
   *
   * @returns The slot index.
   */
  allocateFresh(): number {
    const slot = this.nextSlot();
    this.isAllocatedBySlot[slot] = 1;
    return slot;
  }

  /**
   * Lowers {@link InstanceBuffer.recordCount} past the free slots at its top, so the
   * draw range ends at the last allocated slot and the next fresh slot follows it: slot
   * compaction calls it when a job ends, which keeps a pass's buffer within about twice its
   * records however many jobs run. The trimmed slots leave the free list; they are zeroed already.
   *
   * @returns How many slots were trimmed.
   */
  trimHighWater(): number {
    const before = this.highWaterMark;
    while (this.highWaterMark > 0 && this.isAllocatedBySlot[this.highWaterMark - 1] !== 1)
      this.highWaterMark -= 1;
    if (this.highWaterMark === before) return 0;
    const top = this.highWaterMark;
    const kept = this.freeSlots.filter((slot) => slot < top);
    this.freeSlots.length = 0;
    this.freeSlots.push(...kept);
    return before - top;
  }

  /**
   * Orders the free slots so `allocate` hands them out lowest first: released slots are
   * otherwise reused most recent first. Slot compaction releases a run of objects and allocates
   * them again in paint order, so they land in the lowest free slots, ascending.
   */
  reuseLowestFirst(): void {
    this.freeSlots.sort((left, right) => right - left);
  }

  /**
   * The slots written since the last {@link InstanceBuffer.clearDirty}, each once, in the order
   * they were first written: exact, where `dirtyRanges` bridges small gaps (the batched
   * path strokes re-sync only these records). A live view, emptied by `clearDirty`.
   *
   * @returns The slots.
   */
  get changedSlots(): readonly number[] {
    return this.dirtySlots;
  }

  /** Forgets every dirty range: call once the ranges have been uploaded. */
  clearDirty(): void {
    for (const slot of this.dirtySlots) this.isDirtyBySlot[slot] = 0;
    this.dirtySlots.length = 0;
    this.cachedRanges = undefined;
  }

  private nextSlot(): number {
    if (this.highWaterMark === this.capacity) this.grow();
    const slot = this.highWaterMark;
    this.highWaterMark += 1;
    return slot;
  }

  /** Doubles the capacity, keeping every record, flag and dirty mark. */
  private grow(): void {
    const capacity = this.capacity * 2;
    const records = new Float32Array(capacity * this.layout.floatsPerRecord);
    records.set(this.records);
    this.records = records;
    const isAllocatedBySlot = new Uint8Array(capacity);
    isAllocatedBySlot.set(this.isAllocatedBySlot);
    this.isAllocatedBySlot = isAllocatedBySlot;
    const isDirtyBySlot = new Uint8Array(capacity);
    isDirtyBySlot.set(this.isDirtyBySlot);
    this.isDirtyBySlot = isDirtyBySlot;
  }

  private markDirty(slot: number): void {
    if (this.isDirtyBySlot[slot] === 1) return;
    this.isDirtyBySlot[slot] = 1;
    this.dirtySlots.push(slot);
    this.cachedRanges = undefined;
  }

  private assertAllocated(slot: number): void {
    if (this.isAllocatedBySlot[slot] !== 1) {
      throw new RangeError(`Slot ${String(slot)} is not allocated.`);
    }
  }
}

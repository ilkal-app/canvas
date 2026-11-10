import { describe, expect, it } from 'vitest';

import { InstanceBuffer } from './instance-buffer.js';
import { resolveInstanceLayout } from './instance-layout.js';

/** Two floats per record: 8-byte stride. */
const LAYOUT = resolveInstanceLayout([{ location: 1, format: 'float32x2' }]);

function record(first: number, second: number): Float32Array {
  return new Float32Array([first, second]);
}

describe('InstanceBuffer', () => {
  it('starts empty and clean', () => {
    const buffer = new InstanceBuffer(LAYOUT, { initialCapacity: 4 });
    expect(buffer.recordCount).toBe(0);
    expect(buffer.liveCount).toBe(0);
    expect(buffer.capacity).toBe(4);
    expect(buffer.byteLength).toBe(32);
    expect(buffer.dirtyRanges).toEqual([]);
  });

  it('hands out slots in order and marks each written record dirty', () => {
    const buffer = new InstanceBuffer(LAYOUT, { initialCapacity: 4, maxGapBytes: 0 });
    const first = buffer.allocate();
    const second = buffer.allocate();
    buffer.write(first, record(1, 2));
    buffer.write(second, record(3, 4));
    expect([first, second]).toEqual([0, 1]);
    expect(buffer.recordCount).toBe(2);
    expect(Array.from(buffer.data.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(buffer.dirtyRanges).toEqual([[0, 16]]);
  });

  it('does not mark a record dirty when a write leaves it unchanged', () => {
    const buffer = new InstanceBuffer(LAYOUT);
    const slot = buffer.allocate();
    expect(buffer.write(slot, record(1, 2))).toBe(true);
    buffer.clearDirty();
    expect(buffer.write(slot, record(1, 2))).toBe(false);
    expect(buffer.dirtyRanges).toEqual([]);
  });

  it('coalesces the records dirtied since the last clear into byte ranges', () => {
    const buffer = new InstanceBuffer(LAYOUT, { initialCapacity: 8, maxGapBytes: 0 });
    for (let index = 0; index < 6; index += 1) buffer.write(buffer.allocate(), record(index, 1));
    buffer.clearDirty();
    buffer.write(4, record(40, 1));
    buffer.write(1, record(10, 1));
    buffer.write(2, record(20, 1));
    expect(buffer.dirtyRanges).toEqual([
      [8, 24],
      [32, 40],
    ]);
    buffer.clearDirty();
    expect(buffer.dirtyRanges).toEqual([]);
  });

  it('zeroes a released record, marks it dirty and reuses its slot first', () => {
    const buffer = new InstanceBuffer(LAYOUT, { initialCapacity: 4, maxGapBytes: 0 });
    const first = buffer.allocate();
    const second = buffer.allocate();
    buffer.write(first, record(1, 2));
    buffer.write(second, record(3, 4));
    buffer.clearDirty();
    buffer.release(first);
    expect(Array.from(buffer.data.subarray(0, 2))).toEqual([0, 0]);
    expect(buffer.dirtyRanges).toEqual([[0, 8]]);
    expect(buffer.liveCount).toBe(1);
    expect(buffer.recordCount).toBe(2);
    expect(buffer.allocate()).toBe(first);
  });

  it('doubles its capacity when full, keeping every record', () => {
    const buffer = new InstanceBuffer(LAYOUT, { initialCapacity: 2 });
    for (let index = 1; index <= 5; index += 1)
      buffer.write(buffer.allocate(), record(index, -index));
    expect(buffer.capacity).toBe(8);
    expect(buffer.byteLength).toBe(64);
    expect(Array.from(buffer.data.subarray(0, 10))).toEqual([1, -1, 2, -2, 3, -3, 4, -4, 5, -5]);
    expect(buffer.dirtyRanges).toEqual([[0, 40]]);
  });

  it('rejects a slot that is not allocated', () => {
    const buffer = new InstanceBuffer(LAYOUT);
    const slot = buffer.allocate();
    buffer.release(slot);
    expect(() => buffer.write(slot, record(0, 0))).toThrow(RangeError);
    expect(() => {
      buffer.release(slot);
    }).toThrow(RangeError);
    expect(() => buffer.write(99, record(0, 0))).toThrow(RangeError);
  });

  it('rejects a record of the wrong length', () => {
    const buffer = new InstanceBuffer(LAYOUT);
    expect(() => buffer.write(buffer.allocate(), new Float32Array(3))).toThrow(RangeError);
  });

  it('leaves a new record clean when it is written as zeros, which the GPU copy already holds', () => {
    const buffer = new InstanceBuffer(LAYOUT);
    expect(buffer.write(buffer.allocate(), record(0, 0))).toBe(false);
    expect(buffer.dirtyRanges).toEqual([]);
  });

  it('rejects a capacity below one record', () => {
    expect(() => new InstanceBuffer(LAYOUT, { initialCapacity: 0 })).toThrow(RangeError);
  });
});

import { expect, it } from 'vitest';

import { InstanceBuffer } from './instance-buffer.js';
import { resolveInstanceLayout } from './instance-layout.js';

function setup(): { buffer: InstanceBuffer; slots: number[] } {
  const buffer = new InstanceBuffer(resolveInstanceLayout([{ location: 1, format: 'float32x4' }]));
  const slots = Array.from({ length: 20 }, () => buffer.allocate());
  for (const slot of slots) buffer.write(slot, Float32Array.of(slot, 2, 3, 4));
  buffer.clearDirty();
  return { buffer, slots };
}

it.each([3, 4])(
  'matches sequential partial writes byte for byte for shuffled prefixes (%s floats)',
  (length) => {
    const actual = setup();
    const expected = setup();
    const slots = [12, 2, 9, 12, 1, 19];
    const values = Float32Array.of(-0, 19, Infinity, -Infinity).slice(0, length);
    let changed = 0;
    for (const slot of slots.slice(0, 5))
      changed += Number(expected.buffer.writePartial(slot, 0, values));
    expect(actual.buffer.writePartialMany(slots, 5, 0, values)).toBe(changed);
    expect(new Uint8Array(actual.buffer.data.buffer)).toEqual(
      new Uint8Array(expected.buffer.data.buffer),
    );
    expect(actual.buffer.dirtyRanges).toEqual(expected.buffer.dirtyRanges);
    actual.buffer.clearDirty();
    expect(actual.buffer.writePartialMany(slots, 5, 0, values)).toBe(0);
    expect(actual.buffer.dirtyRanges).toEqual([]);
  },
);

it.each([false, true])(
  'preserves overlapping source slices and NaN payload bits (alias: %s)',
  (isAliased) => {
    const actual = setup();
    const expected = setup();
    const values = new Float32Array(new Uint32Array([0x7f800001, 0x80000000, 0x3f800000]).buffer);
    actual.buffer.data.set(values);
    expected.buffer.data.set(values);
    const source = isAliased ? actual.buffer.data.subarray(0, 3) : values;
    const reference = isAliased ? expected.buffer.data.subarray(0, 3) : values;
    for (const slot of [0, 2, 1]) expected.buffer.writePartial(slot, 1, reference);
    actual.buffer.writePartialMany([0, 2, 1], 3, 1, source);
    expect(new Uint8Array(actual.buffer.data.buffer)).toEqual(
      new Uint8Array(expected.buffer.data.buffer),
    );
    expect(actual.buffer.dirtyRanges).toEqual(expected.buffer.dirtyRanges);
  },
);

it('rejects invalid batch bounds and retains earlier writes when a later slot is invalid', () => {
  const { buffer } = setup();
  const values = Float32Array.of(8);
  for (const count of [-1, 0.5, 3, NaN])
    expect(() => buffer.writePartialMany([0, 1], count, 0, values)).toThrow(RangeError);
  for (const offset of [-1, 0.5, 4, NaN])
    expect(() => buffer.writePartialMany([0], 1, offset, values)).toThrow(RangeError);
  expect(buffer.writePartialMany([], 0, NaN, values)).toBe(0);
  buffer.release(1);
  buffer.clearDirty();
  expect(() => buffer.writePartialMany([0, 1], 2, 0, values)).toThrow(RangeError);
  expect(buffer.data[0]).toBe(8);
  expect(buffer.dirtyRanges).toEqual([[0, 16]]);
});

it.each([false, true])('preserves four-float source overlap and payloads (NaN: %s)', (hasNaN) => {
  const actual = setup();
  const expected = setup();
  const bits = new Uint32Array([
    hasNaN ? 0x7f800001 : 0x3f800000,
    0x80000000,
    0x3f000000,
    0x7f800000,
  ]);
  const values = new Float32Array(bits.buffer);
  actual.buffer.data.set(values, 1);
  expected.buffer.data.set(values, 1);
  const source = actual.buffer.data.subarray(1, 5);
  const reference = expected.buffer.data.subarray(1, 5);
  for (const slot of [0, 2, 1, 2]) expected.buffer.writePartial(slot, 0, reference);
  actual.buffer.writePartialMany([0, 2, 1, 2], 4, 0, source);
  expect(new Uint8Array(actual.buffer.data.buffer)).toEqual(
    new Uint8Array(expected.buffer.data.buffer),
  );
  expect(actual.buffer.dirtyRanges).toEqual(expected.buffer.dirtyRanges);
});

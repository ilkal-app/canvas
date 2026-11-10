import { expect, it } from 'vitest';

import { InstanceBuffer } from './instance-buffer.js';
import { resolveInstanceLayout } from './instance-layout.js';

it('writes only a retained record slice and dirties only changed allocated records', () => {
  const buffer = new InstanceBuffer(resolveInstanceLayout([{ location: 1, format: 'float32x4' }]));
  const slot = buffer.allocate();
  buffer.write(slot, Float32Array.of(1, 2, 3, 4));
  buffer.clearDirty();
  expect(buffer.writePartial(slot, 1, Float32Array.of(2, 3))).toBe(false);
  expect(buffer.dirtyRanges).toEqual([]);
  expect(buffer.writePartial(slot, 1, Float32Array.of(9, 8))).toBe(true);
  expect([...buffer.data.slice(0, 4)]).toEqual([1, 9, 8, 4]);
  expect(buffer.dirtyRanges).toEqual([[0, 16]]);
  for (const offset of [-1, 0.5, 4, Number.NaN])
    expect(() => buffer.writePartial(slot, offset, Float32Array.of(1))).toThrow(RangeError);
  buffer.release(slot);
  expect(() => buffer.writePartial(slot, 0, Float32Array.of(1))).toThrow(RangeError);
});

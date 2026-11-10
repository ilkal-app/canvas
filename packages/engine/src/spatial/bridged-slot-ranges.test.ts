import { expect, it, vi } from 'vitest';

import { BridgedSlots } from './bridged-slots.js';
import { SparseRanges } from './sparse-ranges.js';
import { coalesceMarkedSlots } from './visible-ranges.js';

it.each([0, 1, 16])(
  'matches full coverage and exact deltas after bulk patches with gap %i',
  (gap) => {
    const slots = new BridgedSlots(gap);
    const marks = new Uint8Array(500);
    let seed = 156;
    for (let frame = 0; frame < 200; frame += 1) {
      const previous = slots.ranges;
      for (let patch = 0; patch < 10; patch += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const start = seed % marks.length;
        const count = Math.min((seed >>> 8) % 60, marks.length - start);
        const isMarked = (seed & 4096) !== 0;
        marks.fill(Number(isMarked), start, start + count);
        slots.setRange({ start, count }, isMarked);
      }
      const delta = slots.finish();
      expect(slots.ranges).toEqual(coalesceMarkedSlots(marks, gap));
      const drawn = new Uint8Array(marks.length);
      for (const { start, count } of previous) drawn.fill(1, start, start + count);
      for (const { start, count } of delta.removed) drawn.fill(0, start, start + count);
      for (const { start, count } of delta.added) drawn.fill(1, start, start + count);
      expect(coalesceMarkedSlots(drawn, 0)).toEqual(slots.ranges);
    }
  },
);

it('updates a long contiguous run with bounded sparse-range operations', () => {
  const slots = new BridgedSlots(16);
  const add = vi.spyOn(SparseRanges.prototype, 'add');
  const remove = vi.spyOn(SparseRanges.prototype, 'remove');
  try {
    slots.setRange({ start: 0, count: 30_000 }, true);
    expect(add.mock.calls.length).toBeLessThanOrEqual(4);
    slots.finish();
    remove.mockClear();
    slots.setRange({ start: 100, count: 20_000 }, false);
    expect(remove.mock.calls.length).toBeLessThanOrEqual(4);
    expect(slots.finish().removed).toEqual([{ start: 100, count: 20_000 }]);
    expect(slots.ranges).toEqual([
      { start: 0, count: 100 },
      { start: 20_100, count: 9900 },
    ]);
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
});

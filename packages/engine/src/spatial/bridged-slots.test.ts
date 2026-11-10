import { describe, expect, it } from 'vitest';

import { BridgedSlots } from './bridged-slots.js';
import { coalesceMarkedSlots } from './visible-ranges.js';

describe('incremental bridged slot ranges', () => {
  it.each([0, 1, 16])('matches a full scan after seeded slot patches with gap %i', (gap) => {
    const slots = new BridgedSlots(gap);
    const marks = new Uint8Array(500);
    let seed = 156;
    for (let frame = 0; frame < 200; frame += 1) {
      const previous = slots.ranges;
      for (let patch = 0; patch < 10; patch += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const slot = seed % marks.length;
        const isMarked = (seed & 4096) !== 0;
        marks[slot] = Number(isMarked);
        slots.set(slot, isMarked);
      }
      const delta = slots.finish();
      expect(slots.ranges).toEqual(coalesceMarkedSlots(marks, gap));
      const drawn = new Uint8Array(marks.length);
      for (const { start, count } of previous) drawn.fill(1, start, start + count);
      for (const { start, count } of delta.removed) drawn.fill(0, start, start + count);
      for (const { start, count } of delta.added) drawn.fill(1, start, start + count);
      expect(coalesceMarkedSlots(drawn, 0)).toEqual(slots.ranges);
    }
  });

  it('includes offscreen slots newly covered by a bridge and removes them when it splits', () => {
    const slots = new BridgedSlots(16);
    slots.set(0, true);
    slots.set(34, true);
    slots.finish();
    slots.set(17, true);
    expect(slots.finish().added).toEqual([{ start: 1, count: 33 }]);
    expect(slots.ranges).toEqual([{ start: 0, count: 35 }]);
    slots.set(17, false);
    expect(slots.finish().removed).toEqual([{ start: 1, count: 33 }]);
    expect(slots.ranges).toEqual([
      { start: 0, count: 1 },
      { start: 34, count: 1 },
    ]);
  });

  it('retains output identity when marking a gap or canceling a patch changes no final coverage', () => {
    const slots = new BridgedSlots(16);
    slots.set(0, true);
    slots.set(10, true);
    slots.finish();
    const before = slots.ranges;
    slots.set(5, true);
    slots.set(0, false);
    slots.set(0, true);
    expect(slots.finish()).toEqual({ added: [], removed: [] });
    expect(slots.ranges).toBe(before);
  });
  it('starts from ordered marked runs and patches their bridges without rebuilding', () => {
    const slots = new BridgedSlots(16, [
      { start: 0, count: 2 },
      { start: 18, count: 2 },
    ]);
    expect(slots.ranges).toEqual([{ start: 0, count: 20 }]);
    slots.set(1, false);
    expect(slots.finish().removed).toEqual([{ start: 1, count: 17 }]);
    expect(slots.ranges).toEqual([
      { start: 0, count: 1 },
      { start: 18, count: 2 },
    ]);
  });
});

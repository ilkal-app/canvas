import { expect, it } from 'vitest';

import { SlotEntryRanges } from './slot-entry-ranges.js';

it('preserves first ownership across overlapping ranges, holes and repeated removals', () => {
  const records = new SlotEntryRanges();
  expect(records.add({ start: 10, count: 10 }, 0)).toEqual([{ start: 10, count: 10 }]);
  expect(records.add({ start: 5, count: 10 }, 1)).toEqual([{ start: 5, count: 5 }]);
  records.add({ start: 30, count: 5 }, 2);
  records.prepare();
  expect([4, 5, 14, 20, 30, 35].map((slot) => records.get(slot))).toEqual([
    undefined,
    1,
    0,
    undefined,
    2,
    undefined,
  ]);
  records.delete(14);
  records.delete(14);
  expect(records.has(14)).toBe(false);
  expect(records.get(15)).toBe(0);
});

it('matches a per-slot ownership map under shuffled overlapping ranges and departures', () => {
  let seed = 713;
  const random = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 100; trial++) {
    const records = new SlotEntryRanges();
    const reference = new Map<number, number>();
    for (let entry = 0; entry < 30; entry++) {
      const start = Math.floor(random() * 1000);
      const count = Math.floor(random() * 100);
      records.add({ start, count }, entry);
      for (let slot = start; slot < start + count; slot++)
        if (!reference.has(slot)) reference.set(slot, entry);
    }
    records.prepare();
    for (let step = 0; step < 100; step++) {
      const slot = Math.floor(random() * 1100);
      records.delete(slot);
      reference.delete(slot);
    }
    for (let slot = 0; slot < 1100; slot++) expect(records.get(slot)).toBe(reference.get(slot));
  }
});

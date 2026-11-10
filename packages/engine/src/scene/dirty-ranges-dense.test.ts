import { afterEach, expect, it, vi } from 'vitest';

import { coalesceDirtyRecords } from './dirty-ranges.js';

afterEach(() => vi.restoreAllMocks());

it('coalesces a dense flagged span without sorting its dirty slots', () => {
  const records = Array.from({ length: 200 }, (unused, index) => 199 - index);
  const flags = new Uint8Array(200).fill(1);
  const sort = vi.spyOn(Int32Array.prototype, 'sort');
  expect(coalesceDirtyRecords(records, 16, 0, flags)).toEqual([[0, 3200]]);
  expect(sort).not.toHaveBeenCalled();
});

it('matches sorted coalescing across shuffled dense gaps and byte allowances', () => {
  let seed = 130;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let sample = 0; sample < 80; sample += 1) {
    const flags = new Uint8Array(500);
    const records: number[] = [];
    for (let slot = 20; slot < 480; slot += 1) {
      if (random() < 0.4) continue;
      records.push(slot);
      flags[slot] = 1;
    }
    for (let index = records.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      const saved = records[index];
      const replacement = records[other];
      if (saved === undefined || replacement === undefined) throw new Error('Missing slot');
      records[index] = replacement;
      records[other] = saved;
    }
    for (const gap of [0, 7, 8, 15, 16, 31, 1024]) {
      const expected = coalesceDirtyRecords(records, 8, gap);
      const original = [...records];
      expect(coalesceDirtyRecords(records, 8, gap, flags)).toEqual(expected);
      expect(records).toEqual(original);
    }
  }
});

it('retains sparse sorting when scanning a large mostly clean buffer would cost more', () => {
  const records = [99999, 0, 50000];
  const flags = new Uint8Array(100000);
  for (const slot of records) flags[slot] = 1;
  expect(coalesceDirtyRecords(records, 4, 0, flags)).toEqual([
    [0, 4],
    [200000, 200004],
    [399996, 400000],
  ]);
});

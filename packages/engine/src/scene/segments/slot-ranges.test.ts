import { describe, expect, it } from 'vitest';

import { holdsSlot, patchRanges, rangesOf, SlotChanges } from './slot-ranges.js';

describe('slot ranges', () => {
  it('joins ascending slots into ranges, repeats once', () => {
    expect(rangesOf([])).toEqual([]);
    expect(rangesOf([1, 2, 2, 3, 7, 9, 10])).toEqual([
      { start: 1, count: 3 },
      { start: 7, count: 1 },
      { start: 9, count: 2 },
    ]);
  });

  it('finds a slot in sorted ranges', () => {
    const ranges = [
      { start: 2, count: 3 },
      { start: 10, count: 1 },
    ];
    expect([0, 2, 4, 5, 9, 10, 11].map((slot) => holdsSlot(ranges, slot))).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(holdsSlot([], 0)).toBe(false);
  });

  it('adds ranges, joining what touches, then takes ranges out', () => {
    const ranges = [
      { start: 0, count: 2 },
      { start: 10, count: 5 },
    ];
    expect(patchRanges(ranges, [{ start: 2, count: 3 }], [])).toEqual([
      { start: 0, count: 5 },
      { start: 10, count: 5 },
    ]);
    expect(patchRanges(ranges, [{ start: 11, count: 1 }], [])).toEqual(ranges);
    expect(patchRanges(ranges, [], [{ start: 11, count: 2 }])).toEqual([
      { start: 0, count: 2 },
      { start: 10, count: 1 },
      { start: 13, count: 2 },
    ]);
    expect(
      patchRanges(
        ranges,
        [{ start: 20, count: 1 }],
        [
          { start: 0, count: 1 },
          { start: 9, count: 7 },
        ],
      ),
    ).toEqual([
      { start: 1, count: 1 },
      { start: 20, count: 1 },
    ]);
    expect(patchRanges([], [], [{ start: 0, count: 1 }])).toEqual([]);
  });

  it('nets slot changes: a slot added and removed, in either order, is no change', () => {
    const changes = new SlotChanges();
    changes.add(5);
    changes.add(5);
    changes.add(6);
    changes.remove(5);
    changes.remove(9);
    changes.add(9);
    changes.remove(1);
    expect(changes.added()).toEqual([{ start: 6, count: 1 }]);
    expect(changes.removed()).toEqual([{ start: 1, count: 1 }]);
    changes.add(2);
    expect(changes.added()).toEqual([
      { start: 2, count: 1 },
      { start: 6, count: 1 },
    ]);
  });
});

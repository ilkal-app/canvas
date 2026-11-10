import { describe, expect, it } from 'vitest';

import { coalesceDirtyRecords } from './dirty-ranges.js';

describe('coalesceDirtyRecords', () => {
  it('returns no ranges when nothing is dirty', () => {
    expect(coalesceDirtyRecords([], 16, 0)).toEqual([]);
  });

  it('turns one dirty record into its byte range', () => {
    expect(coalesceDirtyRecords([3], 16, 0)).toEqual([[48, 64]]);
  });

  it('merges adjacent records into one range whatever order they were marked in', () => {
    expect(coalesceDirtyRecords([5, 3, 4], 8, 0)).toEqual([[24, 48]]);
  });

  it('keeps records separated by a gap wider than the allowance apart', () => {
    expect(coalesceDirtyRecords([0, 4], 16, 32)).toEqual([
      [0, 16],
      [64, 80],
    ]);
  });

  it('bridges a gap no wider than the allowance, rewriting the clean records between', () => {
    expect(coalesceDirtyRecords([0, 3], 16, 32)).toEqual([[0, 64]]);
  });

  it('does not mutate the list it is given', () => {
    const records = [9, 2, 5];
    coalesceDirtyRecords(records, 4, 0);
    expect(records).toEqual([9, 2, 5]);
  });

  it('rejects a negative gap allowance', () => {
    expect(() => coalesceDirtyRecords([1], 4, -4)).toThrow(RangeError);
  });
});

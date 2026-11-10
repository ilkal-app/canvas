import { describe, expect, it } from 'vitest';

import { splitRangesByPage } from './page-split.js';

describe('splitRangesByPage', () => {
  it('gives each page the runs of consecutive slots on it, pages ascending', () => {
    const pages = Int32Array.from([1, 1, 0, 0, 1, 2, 2]);
    expect(splitRangesByPage([{ start: 0, count: 7 }], pages)).toEqual([
      { page: 0, ranges: [{ start: 2, count: 2 }] },
      {
        page: 1,
        ranges: [
          { start: 0, count: 2 },
          { start: 4, count: 1 },
        ],
      },
      { page: 2, ranges: [{ start: 5, count: 2 }] },
    ]);
  });

  it('joins runs of one page that touch across ranges and keeps one entry for one page', () => {
    const pages = Int32Array.from([3, 3, 3, 3]);
    expect(
      splitRangesByPage(
        [
          { start: 0, count: 2 },
          { start: 2, count: 2 },
        ],
        pages,
      ),
    ).toEqual([{ page: 3, ranges: [{ start: 0, count: 4 }] }]);
  });

  it('reads slots past the table as page 0 and splits nothing when the ranges are empty', () => {
    expect(splitRangesByPage([{ start: 1, count: 3 }], Int32Array.from([5]))).toEqual([
      { page: 0, ranges: [{ start: 1, count: 3 }] },
    ]);
    expect(splitRangesByPage([], Int32Array.from([1]))).toEqual([]);
  });
});

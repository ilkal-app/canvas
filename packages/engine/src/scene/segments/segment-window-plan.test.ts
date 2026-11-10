import { expect, it } from 'vitest';

import { planSegmentDraws, type PlannedPass, type SegmentPlanInput } from './segment-plan.js';

function input(): SegmentPlanInput {
  const passes: PlannedPass[] = [
    {
      name: 'image',
      owners: {
        rankOfSlot: Int32Array.of(0, 7, -1, 5, 6, 5, 3),
        recordOfSlot: Int32Array.of(0, 0, -1, 0, 0, 1, 0),
      },
      pageOfSlot: Int32Array.of(0, 2, 0, 3, 1, 0, 4),
      isPaintOrderedAcrossPages: true,
      isHiddenByRank: Uint8Array.of(0, 0, 0, 0, 0, 0, 1, 0),
    },
  ];
  return {
    passes,
    isOccluderByRank: new Uint8Array(10).fill(1),
    visible: [{ passName: 'image', ranges: [{ start: 1, count: 5 }] }],
    boundsOfRank: (rank) => ({ minX: rank, minY: 0, maxX: rank + 20, maxY: 20 }),
  };
}

it('plans a bounded nonzero rank window while retaining global GPU slots and hidden/page rules', () => {
  const source = input();
  const reference = planSegmentDraws(source);
  const window = planSegmentDraws({ ...source, rankOffset: 5, rankCount: 3 });
  expect(window.entries).toEqual(reference.entries);
  expect(window.passMaskByRank).toEqual(reference.passMaskByRank.slice(5, 8));
  expect(window.segmentOfRank).toEqual(reference.segmentOfRank.slice(5, 8));
  expect(window.splitOfRank).toEqual(reference.splitOfRank.slice(5, 8));
  expect(window.pageSpans[0]?.minPageByRank).toEqual(
    reference.pageSpans[0]?.minPageByRank.slice(5, 8),
  );
  expect(window.pageSpans[0]?.maxPageByRank).toEqual(
    reference.pageSpans[0]?.maxPageByRank.slice(5, 8),
  );
});

it('rejects a window containing an owned GPU slot outside its rank interval', () => {
  expect(() => planSegmentDraws({ ...input(), rankOffset: 6, rankCount: 2 })).toThrow(RangeError);
});

it.each([
  [-1, 3],
  [5, -1],
  [8, 3],
  [1.5, 2],
])('rejects invalid offset/count %s/%s', (rankOffset, rankCount) => {
  expect(() => planSegmentDraws({ ...input(), rankOffset, rankCount })).toThrow(RangeError);
});

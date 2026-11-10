import { expect, it, vi } from 'vitest';

import type { CullRangeChange } from '../scene-culler.js';

import { planSegmentDraws } from './segment-plan.js';
import { SegmentWindow } from './segment-window.js';
import { SegmentWindows } from './segment-windows.js';

it('routes a contiguous departure as one range without crossing unowned slots', () => {
  const owners = {
    rankOfSlot: Int32Array.from({ length: 20_000 }, (unused, rank) => rank),
    recordOfSlot: new Int32Array(20_000),
  };
  owners.rankOfSlot[5_000] = -1;
  const input = {
    passes: [{ name: 'shape', owners }],
    visible: [{ passName: 'shape', ranges: [{ start: 0, count: 20_000 }] }],
    isOccluderByRank: new Uint8Array(20_000),
  };
  let change: CullRangeChange = {
    source: {},
    revision: 0,
    previousRevision: -1,
    added: [],
    removed: [],
  };
  const cache = new SegmentWindows(
    planSegmentDraws(input),
    input,
    () => change,
    (rank) => [rank],
    // Half the board leaves: routing is the subject here, not the cost guard.
    { minGuardedRecords: Infinity },
  );
  const remove = vi.spyOn(SegmentWindow.prototype, 'remove');
  try {
    change = {
      ...change,
      revision: 1,
      previousRevision: 0,
      removed: [{ start: 100, count: 10_000 }],
    };
    const patched = cache.patch();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0]?.[0].get('shape')?.removed).toEqual([
      { start: 100, count: 4_900 },
      { start: 5_001, count: 5_099 },
    ]);
    expect(patched?.passMaskByRank).toEqual(
      planSegmentDraws({
        ...input,
        visible: [
          {
            passName: 'shape',
            ranges: [
              { start: 0, count: 100 },
              { start: 10_100, count: 9_900 },
            ],
          },
        ],
      }).passMaskByRank,
    );
  } finally {
    remove.mockRestore();
  }
});

it.each([false, true])(
  'counts all entering records for broad fallback (singletons: %s)',
  (isSingleton) => {
    const shapeRanks = [0, 1, 2, 3, 4, ...Array<number>(10).fill(5), 6, 7, 8, 9, 10];
    const passes = [
      {
        name: 'shape',
        owners: { rankOfSlot: Int32Array.from(shapeRanks), recordOfSlot: new Int32Array(20) },
      },
      {
        name: 'text',
        owners: {
          rankOfSlot: Int32Array.from({ length: 11 }, (unused, rank) => rank),
          recordOfSlot: new Int32Array(11),
        },
      },
    ];
    const input = {
      passes,
      visible: [
        {
          passName: 'shape',
          ranges: [
            { start: 0, count: 5 },
            { start: 15, count: 5 },
          ],
        },
        { passName: 'text', ranges: [{ start: 0, count: 11 }] },
      ],
      isOccluderByRank: new Uint8Array(11).fill(1),
    };
    const changes = new Map<string, CullRangeChange>(
      passes.map(({ name }) => [
        name,
        {
          source: {},
          revision: 0,
          previousRevision: -1,
          added: [],
          removed: [],
        },
      ]),
    );
    const cache = new SegmentWindows(
      planSegmentDraws(input),
      input,
      (name) => changes.get(name),
      (rank) => [rank],
    );
    const before = changes.get('shape');
    if (!before) throw new Error('Missing shape cursor');
    changes.set('shape', {
      ...before,
      revision: 1,
      previousRevision: 0,
      added: isSingleton
        ? Array.from({ length: 10 }, (unused, index) => ({ start: index + 5, count: 1 }))
        : [{ start: 5, count: 10 }],
    });
    expect(cache.patch()).toBeUndefined();
    expect(cache.counts).toMatchObject({ wideFallbacks: 1, repairs: 0 });
  },
);

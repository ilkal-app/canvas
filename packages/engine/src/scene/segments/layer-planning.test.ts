import { describe, expect, it } from 'vitest';

import { id, layeredInput, PAINT_ORDER, pass } from './__fixtures__/layered-board.js';
import { boundsOfLayer, planLayeredDraws } from './layer-planning.js';

const input = layeredInput;

describe('planLayeredDraws', () => {
  it('plans nested windows innermost first, each with its children’s composites, then the canvas', () => {
    const plan = planLayeredDraws(input());
    expect(plan.entries).toEqual([
      { passName: 'shape', ranges: [{ start: 2, count: 1 }], layer: 'M' },
      { passName: 'shape', ranges: [{ start: 1, count: 1 }], layer: 'L' },
      { passName: 'composite', ranges: [{ start: 1, count: 1 }], layer: 'L' },
      { passName: 'shape', ranges: [{ start: 0, count: 1 }] },
      { passName: 'composite', ranges: [{ start: 0, count: 1 }] },
      { passName: 'title', page: 0, ranges: [{ start: 0, count: 1 }] },
    ]);
    expect(plan.layers).toEqual([
      { id: 'M', slot: 1, parent: 'L', bounds: { minX: 0, minY: 0, maxX: 10, maxY: 30 } },
      { id: 'L', slot: 0, parent: undefined, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 30 } },
    ]);
    expect(plan.spans).toEqual([
      { open: 3, close: 5 },
      { open: 1, close: 6 },
    ]);
    expect(plan.hasSpatialMerges).toBe(false);
  });

  it('draws neither content nor composite of a layer at opacity 0', () => {
    const plan = planLayeredDraws(input({ invisibleIds: new Set([id('z'), id('M')]) }));
    expect(plan.layers.map((layer) => layer.id)).toEqual(['L']);
    expect(plan.entries.filter((entry) => entry.passName === 'composite')).toEqual([
      { passName: 'composite', ranges: [{ start: 0, count: 1 }] },
    ]);
    expect(plan.entries.some((entry) => entry.ranges.some(({ start }) => start === 2))).toBe(false);
  });

  it('leaves out a layer with nothing visible, and its composite', () => {
    const plan = planLayeredDraws(
      input({
        visible: [
          { passName: 'shape', ranges: [{ start: 0, count: 1 }] },
          { passName: 'composite', ranges: [{ start: 0, count: 2 }] },
        ],
      }),
    );
    expect(plan.layers).toEqual([]);
    expect(plan.entries).toEqual([{ passName: 'shape', ranges: [{ start: 0, count: 1 }] }]);
  });

  it('covers the whole plane without boxes, and drops a layer whose members have none', () => {
    const { memberBoundsOf: unused, ...withoutBoxes } = input();
    expect(unused).toBeDefined();
    const everywhere = planLayeredDraws(withoutBoxes);
    expect(everywhere.layers[0]?.bounds).toEqual({
      minX: Number.NEGATIVE_INFINITY,
      minY: Number.NEGATIVE_INFINITY,
      maxX: Number.POSITIVE_INFINITY,
      maxY: Number.POSITIVE_INFINITY,
    });
    const unmeasured = planLayeredDraws(input({ memberBoundsOf: () => undefined }));
    expect(unmeasured.layers).toEqual([]);
    expect(boundsOfLayer({ paintOrder: PAINT_ORDER }, { open: 0, close: 1 })).toBeUndefined();
  });

  it('takes each composite rank’s box from its layer when merging by boxes', () => {
    const asked: number[] = [];
    const plan = planLayeredDraws(
      input({
        boundsOfRank: (rank) => {
          asked.push(rank);
          return { minX: rank * 100, minY: 0, maxX: rank * 100 + 1, maxY: 1 };
        },
        isOccluderByRank: Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 0]),
      }),
    );
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(asked).not.toContain(6);
  });

  it('ignores free slots and refuses an entry naming no pass', () => {
    const free = input();
    const plan = planLayeredDraws({
      ...free,
      passes: [pass('shape', [0, -1, 2, 4, 7]), ...free.passes.slice(1)],
      visible: [{ passName: 'shape', ranges: [{ start: 0, count: 2 }] }],
    });
    expect(plan.entries).toEqual([{ passName: 'shape', ranges: [{ start: 0, count: 1 }] }]);
    expect(() =>
      planLayeredDraws(input({ visible: [{ passName: 'nothing', ranges: [] }] })),
    ).toThrow(RangeError);
  });

  it('skips a layer the rank tables do not know', () => {
    const plan = planLayeredDraws(
      input({
        layerSlots: new Map([
          [id('L'), [0]],
          [id('ghost'), [3]],
          [id('a'), [4]],
          [id('c'), []],
        ]),
      }),
    );
    expect(plan.layers.map((layer) => layer.id)).toEqual(['L']);
  });
});

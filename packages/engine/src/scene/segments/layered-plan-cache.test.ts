import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import { intersectsBounds } from '../../spatial/bounds.js';

import { id, layeredInput, PAINT_ORDER } from './__fixtures__/layered-board.js';
import { planLayeredDraws } from './layer-planning.js';
import { structureOf } from './layer-structure.js';
import { canvasRanksOf, isCanvasPlanKept, windowChangesOf } from './layered-changes.js';
import { compositeChangeOf, isSameFrame, LayeredPlanCache } from './layered-plan-cache.js';
import type { SegmentSpatialIndex } from './segment-moves.js';
import type { SegmentPlan } from './segment-plan.js';

const BOX = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** A plan of a, b, c by rank, merged by boxes (as `segment-moves.test.ts`'s). */
const MERGED: SegmentPlan = {
  entries: [],
  passMaskByRank: Int32Array.of(0b11, 0b11, 0b01),
  segmentOfRank: Int32Array.of(0, 0, 0),
  splitOfRank: Int32Array.of(0, 1, 2),
  segmentCount: 1,
  hasSpatialMerges: true,
  pageSpans: [],
};

/**
 * A spatial index over boxes by id.
 *
 * @param boxes - Each object's box.
 * @returns The index.
 */
function indexOf(boxes: Record<string, WorldBounds | undefined>): SegmentSpatialIndex {
  return {
    boundsOf: (object) => boxes[object],
    searchRect: (rect) =>
      Object.entries(boxes).flatMap(([object, box]) =>
        box !== undefined && intersectsBounds(box, rect) ? [object as ObjectId] : [],
      ),
  };
}

/**
 * A 10-unit box at a point.
 *
 * @param x - Its left.
 * @returns The box.
 */
const at = (x: number): WorldBounds => ({ minX: x, minY: 0, maxX: x + 10, maxY: 10 });

describe('LayeredPlanCache', () => {
  it('keeps a window while its records, composites and ranks stand', () => {
    const cache = new LayeredPlanCache();
    cache.begin(false);
    const request = {
      visible: [{ passName: 'shape', ranges: [{ start: 0, count: 1 }] }],
      childSlots: [3],
      childBounds: [BOX],
      open: 1,
      close: 6,
    };
    let planned = 0;
    const plan = (): SegmentPlan => {
      planned += 1;
      return { ...MERGED, entries: [{ passName: 'shape', ranges: [{ start: 0, count: 1 }] }] };
    };
    const first = cache.window(id('L'), request, plan);
    expect(first.entries).toEqual([
      { passName: 'shape', ranges: [{ start: 0, count: 1 }], layer: 'L' },
    ]);
    expect(cache.window(id('L'), { ...request }, plan)).toBe(first);
    expect(cache.plannedCount).toBe(1);
    expect(cache.window(id('L'), { ...request, close: 7 }, plan)).not.toBe(first);
    expect(cache.window(id('L'), { ...request, childBounds: [at(0)] }, plan).plan).toBeDefined();
    expect(planned).toBe(3);
    cache.forget(id('L'));
    expect(cache.get(id('L'))).toBeUndefined();
    const canvas = cache.window(undefined, request, plan);
    expect(canvas.entries).toEqual(canvas.plan.entries);
    expect(cache.get(undefined)).toBe(canvas);
    cache.window(id('M'), request, plan);
    cache.retain((layer) => layer !== id('M'));
    expect(cache.get(id('M'))).toBeUndefined();
    expect(cache.get(undefined)).toBe(canvas);
    // A plan with or without boxes is not reused for the other.
    cache.begin(true);
    expect(cache.get(undefined)).toBeUndefined();
    expect(cache.plannedCount).toBe(0);
    cache.keep(undefined, request, MERGED);
    cache.clear();
    expect(cache.get(undefined)).toBeUndefined();
  });

  it('compares frames and lists the composites a kept window must add and remove', () => {
    const window = {
      visible: [],
      childSlots: [1, 2],
      childBounds: [at(0), at(10)],
      open: 0,
      close: -1,
      plan: MERGED,
      entries: [],
    };
    expect(isSameFrame(window, window)).toBe(true);
    expect(isSameFrame(window, { ...window, childSlots: [1, 3] })).toBe(false);
    expect(isSameFrame(window, { ...window, childSlots: [1] })).toBe(false);
    expect(
      compositeChangeOf(window, { childSlots: [2, 5], childBounds: [at(10), at(50)] }),
    ).toEqual({ added: [5], removed: [1] });
    expect(compositeChangeOf(window, { childSlots: [2], childBounds: [at(11)] })).toBeUndefined();
    expect(compositeChangeOf(window, { childSlots: [2], childBounds: [] })).toBeUndefined();
  });
});

describe('layered changes', () => {
  it('dirties the windows holding what changed, and lists the canvas’s changed objects', () => {
    const input = layeredInput();
    const { ownerOfRank } = structureOf(input, undefined);
    const changes = windowChangesOf(
      { ...input, moved: [id('a'), id('d'), id('ghost'), id('L')], hiddenRanks: [3] },
      ownerOfRank,
    );
    expect(changes.dirty).toEqual(new Set([0, 1]));
    expect(changes.canvasMoved).toEqual([id('a')]);
    expect(windowChangesOf(input, ownerOfRank)).toEqual({ dirty: new Set(), canvasMoved: [] });
  });

  it('sees a layer member as its outermost layer’s composite on the canvas', () => {
    const input = layeredInput();
    const { layers, ownerOfRank } = structureOf(input, undefined);
    const ranks = canvasRanksOf(input, layers, ownerOfRank);
    expect(['a', 'L', 'c', 'M', 'd', 'z', 'ghost'].map((o) => ranks.rankOf(id(o)))).toEqual([
      0,
      6,
      6,
      6,
      6,
      7,
      undefined,
    ]);
    expect(['a', 'L', 'ghost'].map((o) => ranks.closingRankOf(id(o)))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(canvasRanksOf(input, [], new Int32Array(8).fill(-1)).closingRankOf(id('L'))).toBe(6);
  });

  it('keeps the canvas plan while moved canvas objects meet nothing its merges rested on', () => {
    const rankOf = (object: ObjectId) => ({ a: 0, b: 1, c: 2 })[object as 'a'];
    const check = (moved: string[], boxes: Record<string, WorldBounds>, composites = [at(500)]) =>
      isCanvasPlanKept({
        plan: MERGED,
        moved: moved.map(id),
        composites,
        rankOf,
        closingRankOf: () => undefined,
        spatial: indexOf(boxes),
      });
    expect(check(['b'], { a: at(0), b: at(100), c: at(200) })).toBe(true);
    expect(check(['b'], { a: at(0), b: at(5), c: at(200) })).toBe(false);
    // On a composite's bounds: the plan merged by them.
    expect(check(['b'], { a: at(0), b: at(495), c: at(200) })).toBe(false);
    // Without a box, `checkMovedObjects` judges.
    expect(check(['b'], { a: at(0), c: at(200) })).toBe(false);
    expect(
      isCanvasPlanKept({
        plan: { ...MERGED, hasSpatialMerges: false },
        moved: [id('b')],
        composites: [],
        rankOf,
        closingRankOf: () => undefined,
        spatial: indexOf({}),
      }),
    ).toBe(true);
  });
});

describe('planLayeredDraws with a cache', () => {
  const boxes: Record<string, WorldBounds> = {
    a: at(0),
    L: at(100),
    c: at(100),
    M: at(100),
    d: at(100),
    z: at(900),
  };
  const spatial = indexOf(boxes);
  const boundsOfRank = (rank: number) => boxes[PAINT_ORDER[rank] ?? ''];

  it('plans only the windows that changed, and checks the canvas against what moved on it', () => {
    const cache = new LayeredPlanCache();
    const input = layeredInput({ cache, boundsOfRank, spatial });
    const first = planLayeredDraws(input);
    expect(cache.plannedCount).toBe(3);
    expect(planLayeredDraws(input)).toEqual(first);
    expect(cache.plannedCount).toBe(0);
    planLayeredDraws({ ...input, moved: [id('d')] });
    expect(cache.plannedCount).toBe(1);
    // A canvas object moved: its plan merged nothing by boxes, so it stands.
    planLayeredDraws({ ...input, moved: [id('a')] });
    expect(cache.plannedCount).toBe(0);
    planLayeredDraws({ ...input, hiddenRanks: [0] });
    expect(cache.plannedCount).toBe(1);
  });

  it('plans the canvas again for a move when it merged by boxes and nothing can check it', () => {
    const cache = new LayeredPlanCache();
    const input = layeredInput({ cache, boundsOfRank });
    planLayeredDraws(input);
    const canvas = cache.get(undefined);
    if (canvas === undefined) throw new Error('no canvas window');
    cache.keep(undefined, canvas, { ...canvas.plan, hasSpatialMerges: true });
    planLayeredDraws({ ...input, moved: [id('a')] });
    expect(cache.plannedCount).toBe(1);
    cache.keep(undefined, canvas, { ...canvas.plan, hasSpatialMerges: true });
    // Checked: z draws nothing, so its move breaks nothing; a lands on L's composite.
    planLayeredDraws({ ...input, spatial, moved: [id('z')] });
    expect(cache.plannedCount).toBe(0);
    planLayeredDraws({ ...input, spatial, moved: [id('a')] });
    expect(cache.plannedCount).toBe(1);
  });
});

// A small layered board for the layered planner's tests (C2c): two nested layers,
// a canvas object around them, an object at opacity 0 and a paged pass drawn outside layers.
import type { ObjectId } from '@canvas/schema';

import type { DrawListEntry } from '../../draw-list.js';
import type { LayeredPlanInput } from '../layer-planning.js';
import type { PlannedPass } from '../segment-plan.js';

/**
 * An object id.
 *
 * @param value - The id's text.
 * @returns The id.
 */
export const id = (value: string): ObjectId => value as ObjectId;

/**
 * A pass whose slots belong to the given ranks, record 0 each.
 *
 * @param name - The pass's name.
 * @param ranks - Per slot, its owner's rank.
 * @param pageOfSlot - Per slot, its page, for a paged pass.
 * @returns The planned pass.
 */
export function pass(name: string, ranks: number[], pageOfSlot?: number[]): PlannedPass {
  return {
    name,
    owners: { rankOfSlot: Int32Array.from(ranks), recordOfSlot: new Int32Array(ranks.length) },
    ...(pageOfSlot === undefined ? {} : { pageOfSlot: Int32Array.from(pageOfSlot) }),
  };
}

/** Ranks: 0 a, 1 L (layer), 2 c, 3 M (nested layer), 4 d, 5 M closes, 6 L closes, 7 z (opacity 0). */
export const PAINT_ORDER = ['a', 'L', 'c', 'M', 'd', 'M', 'L', 'z'].map(id);

/**
 * The board, every record visible: shapes in slots 0–3 (ranks 0, 2, 4, 7), the composites of L
 * and M in slots 0 and 1, and L's title (outside layers, page 0) in slot 0.
 *
 * @param overrides - Fields to replace.
 * @returns The input.
 */
export function layeredInput(overrides: Partial<LayeredPlanInput> = {}): LayeredPlanInput {
  const passes = [pass('shape', [0, 2, 4, 7]), pass('composite', [6, 5]), pass('title', [1], [0])];
  const visible: DrawListEntry[] = [
    { passName: 'shape', ranges: [{ start: 0, count: 4 }] },
    { passName: 'composite', ranges: [{ start: 0, count: 2 }] },
    { passName: 'title', page: 0, ranges: [{ start: 0, count: 1 }] },
  ];
  return {
    paintOrder: PAINT_ORDER,
    rankById: new Map([
      [id('a'), 0],
      [id('L'), 1],
      [id('c'), 2],
      [id('M'), 3],
      [id('d'), 4],
      [id('z'), 7],
    ]),
    closingRankById: new Map([
      [id('M'), 5],
      [id('L'), 6],
    ]),
    layerSlots: new Map([
      [id('L'), [0]],
      [id('M'), [1]],
    ]),
    invisibleIds: new Set([id('z')]),
    passes,
    compositePassName: 'composite',
    outsidePassNames: new Set(['title']),
    isOccluderByRank: new Uint8Array(PAINT_ORDER.length),
    visible,
    memberBoundsOf: (object) =>
      object === 'z' ? undefined : { minX: 0, minY: 0, maxX: 10, maxY: object === 'd' ? 30 : 10 },
    ...overrides,
  };
}

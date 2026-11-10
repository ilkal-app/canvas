import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

import {
  layerCandidatesOf,
  remeasureLayers,
  type LayerCandidateInput,
} from './layer-candidates.js';

const id = (value: string): ObjectId => value as ObjectId;

function box(x: number, size: number): WorldBounds {
  return { minX: x, minY: 0, maxX: x + size, maxY: size };
}

function defaultBoxes(): Map<ObjectId, WorldBounds> {
  return new Map<ObjectId, WorldBounds>([
    [id('a'), box(0, 100)],
    [id('b'), box(50, 300)],
    [id('c'), box(0, 10)],
  ]);
}

const PARENTS = new Map<string, string>([
  ['a', 'outer'],
  ['inner', 'outer'],
  ['b', 'inner'],
  ['c', 'hidden'],
]);
const parentOf = (child: ObjectId): ObjectId | null =>
  (PARENTS.get(child) ?? null) as ObjectId | null;

/**
 * The tables of outer ⊃ (a, inner ⊃ b), then hidden ⊃ c at opacity 0, then empty with no boxes,
 * and a layer with no ranks.
 *
 * @param overrides - Fields to change.
 * @param hasBoxes - Whether the members have boxes to measure.
 * @param boxes - The members' boxes.
 * @returns The input.
 */
function input(
  overrides: Partial<LayerCandidateInput> = {},
  hasBoxes = true,
  boxes = defaultBoxes(),
): LayerCandidateInput {
  const paintOrder = [
    'outer',
    'a',
    'inner',
    'b',
    'inner',
    'outer',
    'hidden',
    'c',
    'hidden',
    'empty',
    'empty',
  ].map(id);
  return {
    paintOrder,
    rankById: new Map(
      ['outer', 'a', 'inner', 'b', 'hidden', 'c', 'empty'].map((name) => [
        id(name),
        paintOrder.indexOf(id(name)),
      ]),
    ),
    closingRankById: new Map([
      [id('outer'), 5],
      [id('inner'), 4],
      [id('hidden'), 8],
      [id('empty'), 10],
    ]),
    layerSlots: new Map(
      ['inner', 'outer', 'hidden', 'empty', 'unranked'].map((name, slot) => [id(name), [slot]]),
    ),
    invisibleIds: new Set([id('hidden')]),
    ...(hasBoxes ? { memberBoundsOf: (member: ObjectId) => boxes.get(member) } : {}),
    ...overrides,
  };
}

describe('layerCandidatesOf', () => {
  it('measures each layer with content by its members, with its depth, outermost first', () => {
    const { candidates, boundsById } = layerCandidatesOf(input());
    expect(candidates).toEqual([
      {
        id: 'outer',
        depth: 0,
        bounds: { minX: 0, minY: 0, maxX: 350, maxY: 300 },
        span: { open: 0, close: 5 },
      },
      {
        id: 'inner',
        depth: 1,
        bounds: { minX: 50, minY: 0, maxX: 350, maxY: 300 },
        span: { open: 2, close: 4 },
      },
    ]);
    expect([...boundsById.keys()]).toEqual(['outer', 'inner']);
  });

  it('gives every layer the whole plane without boxes to measure', () => {
    const { candidates } = layerCandidatesOf(input({}, false));
    expect(candidates.map(({ id: layer }) => layer)).toEqual(['outer', 'inner', 'empty']);
    expect(candidates[0]?.bounds.maxX).toBe(Number.POSITIVE_INFINITY);
  });

  it('takes nothing as invisible when no object is at opacity 0', () => {
    const { candidates } = layerCandidatesOf(input({ invisibleIds: new Set() }));
    expect(candidates.map(({ id: layer, depth }) => [layer, depth])).toEqual([
      ['outer', 0],
      ['inner', 1],
      ['hidden', 0],
    ]);
  });
});

describe('remeasureLayers', () => {
  it('measures again only the layers holding or held by what moved', () => {
    const boxes = defaultBoxes();
    const previous = layerCandidatesOf(input({}, true, boxes));
    boxes.set(id('a'), box(-100, 100));
    const moved = remeasureLayers(previous, input({}, true, boxes), [id('a')], parentOf);
    expect(moved?.candidates[0]?.bounds.minX).toBe(-100);
    expect(moved?.candidates[1]).toBe(previous.candidates[1]);
    expect(moved?.boundsById.get(id('outer'))?.minX).toBe(-100);
    boxes.set(id('b'), box(60, 400));
    // The outer layer moved: the inner one inside it is measured again, though it is no ancestor.
    const held = remeasureLayers(previous, input({}, true, boxes), [id('outer')], parentOf);
    expect(held?.candidates[1]?.bounds.maxX).toBe(460);
    // A layer after the moved one's ranks is not held by it.
    const visible = input({ invisibleIds: new Set() }, true, boxes);
    const all = layerCandidatesOf(visible);
    const inner = remeasureLayers(all, visible, [id('inner')], parentOf);
    expect(inner?.candidates[2]).toBe(all.candidates[2]);
    // A move outside every layer measures nothing again.
    expect(remeasureLayers(all, visible, [id('loose')], parentOf)).toBe(all);
  });

  it('keeps the measure without boxes, and gives up where only a full measure will do', () => {
    const previous = layerCandidatesOf(input());
    expect(remeasureLayers(previous, input({}, false), [id('a')], parentOf)).toBe(previous);
    const many = Array.from({ length: 65 }, (unused, index) => id(`m${String(index)}`));
    expect(remeasureLayers(previous, input(), many, parentOf)).toBeUndefined();
    expect(remeasureLayers(previous, input({}, true, new Map()), [id('a')], parentOf)).toBe(
      undefined,
    );
    expect(remeasureLayers(previous, input(), [id('empty')], parentOf)).toBeUndefined();
  });
});

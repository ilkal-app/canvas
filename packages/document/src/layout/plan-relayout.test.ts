import { describe, expect, it } from 'vitest';

import type { AutoLayout, BoardObject, ObjectId } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { planRelayout, type RelayoutSource } from './plan-relayout.js';

// The planner alone, over an in-memory board, for the cases a command cannot reach
// (sizes a peer's raw write left invalid, a stale instance index) and the stacking order.

/** A row that hugs both axes, 10 apart, padded 5 all round. */
const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
};

/**
 * A frame at (100, 100), 400 × 300, at the root, laid out as `ROW`.
 *
 * @param id - Its id.
 * @returns The frame.
 */
function row(id: string): BoardObject {
  return {
    ...fixtureObject('frame-plan', 'frame'),
    id: id as ObjectId,
    parentId: null,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    z: 'a0',
    autoLayout: ROW,
  };
}

/**
 * A shape box inside a parent.
 *
 * @param id - Its id.
 * @param parentId - Its parent.
 * @param z - Its stacking key.
 * @param width - Its width.
 * @param height - Its height.
 * @returns The shape.
 */
function box(id: string, parentId: string, z: string, width: number, height: number): BoardObject {
  return {
    ...fixtureObject('shape-box', 'shape'),
    id: id as ObjectId,
    parentId: parentId as ObjectId,
    x: 0,
    y: 0,
    rotation: 0,
    width,
    height,
    z,
  };
}

/**
 * An in-memory board for the planner.
 *
 * @param objects - The objects.
 * @param instances - Each main's instance ids, as the reference index lists them.
 * @returns The source.
 */
function sourceOf(
  objects: readonly BoardObject[],
  instances: Readonly<Record<string, readonly string[]>> = {},
): RelayoutSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (id) => byId.get(id),
    childrenOf: (id) => objects.filter((object) => object.parentId === id).map(({ id: c }) => c),
    instancesOf: (mainId) => (instances[mainId] ?? []) as ObjectId[],
  };
}

/**
 * The planned position and size of each object, by id.
 *
 * @param planned - The planner's result.
 * @returns `[x, y, width, height]` by id.
 */
function rects(planned: Map<ObjectId, BoardObject>): Record<string, number[]> {
  return Object.fromEntries(
    [...planned].map(([id, object]) => {
      const { x, y, width, height } = object as BoardObject & { width: number; height: number };
      return [id, [x, y, width, height]];
    }),
  );
}

describe('planRelayout', () => {
  it('stacks children of equal z by id, so every client lays them out alike', () => {
    const source = sourceOf([row('f'), box('b', 'f', 'a0', 30, 20), box('a', 'f', 'a0', 40, 10)]);
    const planned = rects(planRelayout(source, ['f' as ObjectId]));
    expect(planned.a).toEqual([5, 5, 40, 10]);
    expect(planned.b).toEqual([55, 5, 30, 20]);
  });

  it('closes the row over a child a write hid, and opens it again once shown', () => {
    const shown = [row('f'), box('a', 'f', 'a0', 20, 20), box('b', 'f', 'a1', 100, 20)];
    const last = box('c', 'f', 'a2', 30, 20);
    const hidden = { ...shown[2], isHidden: true } as BoardObject;
    const closed = rects(
      planRelayout(sourceOf([...shown.slice(0, 2), hidden, last]), ['b' as ObjectId]),
    );
    expect(closed.c).toEqual([35, 5, 30, 20]);
    expect(closed.f).toEqual([100, 100, 70, 30]);
    const open = rects(planRelayout(sourceOf([...shown, last]), ['b' as ObjectId]));
    expect(open.c).toEqual([145, 5, 30, 20]);
  });

  it('leaves a child whose size a peer left invalid, and lays out the rest around it', () => {
    const source = sourceOf([
      row('f'),
      box('a', 'f', 'a0', Number.NaN, 10),
      box('b', 'f', 'a1', 30, 20),
    ]);
    const planned = planRelayout(source, ['f' as ObjectId]);
    expect(planned.has('a' as ObjectId)).toBe(false);
    for (const object of planned.values()) {
      const { x, y, width, height } = object as BoardObject & { width: number; height: number };
      expect([x, y, width, height].every(Number.isFinite)).toBe(true);
    }
  });

  it('gives an instance only the axes it has not fixed', () => {
    const main = { ...row('main'), type: 'component', name: 'Card' } as unknown as BoardObject;
    const instance = {
      ...fixtureObject('frame-plan', 'frame'),
      type: 'instance',
      overrides: {},
      id: 'inst' as ObjectId,
      parentId: null,
      mainId: 'main' as ObjectId,
      width: 7,
      height: 9,
      isHeightFixed: true,
    } as unknown as BoardObject;
    const source = sourceOf([main, box('child', 'main', 'a0', 40, 10), instance], {
      main: ['inst'],
    });
    const planned = rects(planRelayout(source, ['main' as ObjectId]));
    expect(planned.inst?.slice(2)).toEqual([50, 9]);
  });

  it('skips an instance index entry that is not an instance', () => {
    const main = { ...row('main'), type: 'component', name: 'Card' } as unknown as BoardObject;
    const source = sourceOf(
      [main, box('child', 'main', 'a0', 40, 10), box('stale', 'f', 'a0', 1, 1)],
      {
        main: ['stale', 'gone'],
      },
    );
    const planned = planRelayout(source, ['main' as ObjectId]);
    expect(rects(planned).main).toEqual([100, 100, 50, 20]);
    expect(planned.has('stale' as ObjectId)).toBe(false);
  });
});

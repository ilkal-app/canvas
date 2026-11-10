import { describe, expect, it, vi } from 'vitest';

import type { AutoLayout, BoardObject } from '@canvas/schema';

import {
  frame,
  id,
  indexOf,
  mapSource,
  rect,
  selectBoardObjects,
} from './__fixtures__/select-board.js';
import { dropTargetBox, stackDropOf } from './drop-target.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectionSource } from './selection-geometry.js';
import type { TransformPlan } from './transform-plan.js';

type MovePlan = TransformPlan & { readonly kind: 'move' };

const NATIVE_SET = Set;

const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};

function move(names: readonly string[], x: number, y: number): MovePlan {
  return { kind: 'move', ids: names.map(id), delta: { x, y } };
}

function rowObjects(): BoardObject[] {
  return [
    { ...frame('row', null, { x: 100, y: 100, width: 300, height: 100 }), autoLayout: ROW },
    { ...rect('a', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
    { ...rect('b', 'row', { x: 60, y: 10, width: 40, height: 40 }), z: 'a1' },
    { ...rect('c', 'row', { x: 110, y: 10, width: 40, height: 40 }), z: 'a2' },
  ];
}

function tester(objects: BoardObject[]) {
  const source = mapSource(objects);
  return { source, hits: createSelectHitTester(indexOf(objects), source) };
}

describe('stack drop acceptance', () => {
  it('keeps a line primary and a non-stack primary out of the stack', () => {
    const objects = [...rowObjects(), ...selectBoardObjects()];
    const { source, hits } = tester(objects);
    expect(stackDropOf(move(['line-l', 'a'], 0, 0), id('line-l'), source, hits)).toBeUndefined();
    expect(stackDropOf(move(['a', 'line-l'], 0, 0), id('line-l'), source, hits)).toBeUndefined();
    expect(
      stackDropOf(move(['connector-k', 'a'], 0, 0), id('connector-k'), source, hits),
    ).toBeUndefined();
  });

  it('rejects a different landing, and keeps the exact row slot for a reorder', () => {
    const { source, hits } = tester(rowObjects());
    expect(stackDropOf(move(['a', 'b'], -120, 0), id('a'), source, hits)).toBeUndefined();
    expect(stackDropOf(move(['b'], -55, 0), id('b'), source, hits)).toMatchObject({
      containerId: 'row',
      belowId: 'a',
    });
  });

  it('does not preview or hit-test every leaf on a frameless board', () => {
    const objects = Array.from({ length: 1000 }, (unused, n) =>
      rect(`leaf-${String(n)}`, null, { x: n * 20, y: 0, width: 10, height: 10 }),
    );
    const { source, hits } = tester(objects);
    const frameAt = vi.spyOn(hits, 'frameAt');
    const plan = move(
      objects.map((object) => object.id),
      0,
      30,
    );
    expect(stackDropOf(plan, plan.ids[0], source, hits)).toBeUndefined();
    expect(frameAt.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('stops at the first different landing after finding a stack for the primary', () => {
    const objects = [
      ...rowObjects(),
      rect('outside', null, { x: 500, y: 300, width: 40, height: 40 }),
      ...Array.from({ length: 200 }, (unused, n) =>
        rect(`tail-${String(n)}`, 'row', { x: 1000 + n * 10, y: 1000, width: 5, height: 5 }),
      ),
    ];
    const base = mapSource(objects);
    const reads = new Map<string, number>();
    const source: SelectionSource = {
      get: (objectId) => {
        reads.set(objectId, (reads.get(objectId) ?? 0) + 1);
        return base.get(objectId);
      },
      childrenOf: (objectId) => base.childrenOf(objectId),
    };
    const hits = createSelectHitTester(indexOf(objects), source);
    const names = [
      'a',
      'outside',
      ...objects.filter((object) => object.id.startsWith('tail-')).map((object) => object.id),
    ];
    expect(stackDropOf(move(names, 0, 0), id('a'), source, hits)).toBeUndefined();
    expect(reads.get('tail-199') ?? 0).toBe(0);
  });

  it('builds no moved-id set of its own when the gesture supplies one', () => {
    const objects = Array.from({ length: 50 }, (unused, n) =>
      rect(`leaf-${String(n)}`, null, { x: n * 20, y: 0, width: 10, height: 10 }),
    );
    const { source, hits } = tester(objects);
    const plan = move(
      objects.map((object) => object.id),
      0,
      30,
    );
    const movedIds = new Set(plan.ids);
    let built = 0;
    class CountingSet<T> extends NATIVE_SET<T> {
      constructor(values?: Iterable<T> | null) {
        super(values);
        if (values === plan.ids) built += 1;
      }
    }
    vi.stubGlobal('Set', CountingSet);
    try {
      stackDropOf(plan, plan.ids[0], source, hits, movedIds);
      dropTargetBox(plan, plan.ids[0], source, hits, movedIds);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(built).toBe(0);
  });

  it('keeps a frameless drop target absent over repeated moves', () => {
    const objects = [rect('a', null, { x: 0, y: 0, width: 20, height: 20 })];
    const { source, hits } = tester(objects);
    for (let x = 1; x <= 20; x += 1) {
      expect(dropTargetBox(move(['a'], x, 0), id('a'), source, hits)).toBeUndefined();
    }
  });
});

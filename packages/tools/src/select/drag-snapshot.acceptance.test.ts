import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { snapCandidatesNear } from '../snap/snap-candidates.js';

import { move } from './__fixtures__/drag-snap-steps.js';
import { id, indexOf, mapSource, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, storeSource } from './__fixtures__/select-store.js';
import { DragSnapper, type SnapView } from './drag-snapper.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectPointer } from './select-input.js';
import { snapTransform } from './snap-transform.js';

const START: OrientedBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
const VIEWPORT: WorldBounds = { minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 };
const POINTER: SelectPointer = {
  screen: { x: 97, y: 25 },
  world: { x: 97, y: 25 },
  isShiftPressed: false,
  isModPressed: false,
  isSnapSuspended: false,
};
const view = (viewport = VIEWPORT): SnapView => ({
  settings: { isEnabled: true, isGridVisible: false },
  viewport,
});

function harness(objects: BoardObject[]) {
  const inner = indexOf(objects);
  let queries = 0;
  const index = {
    searchRect: (bounds: WorldBounds) => {
      queries += 1;
      return inner.searchRect(bounds);
    },
    boundsOf: (objectId: ObjectId) => inner.boundsOf(objectId),
  };
  const snapper = new DragSnapper(index, mapSource(objects));
  snapper.follow(POINTER, 1, view());
  return { snapper, queries: () => queries, index: inner };
}

function changed(target: object): void {
  const method = Reflect.get(target, 'documentChanged') as (() => void) | undefined;
  expect(method).toBeTypeOf('function');
  method?.call(target);
}

// PR2 measured the per-gesture candidate snapshot slower than live band queries (a 200-move
// drag over about 2,000 candidates: 17.7 → 22.3 ms, drag-snapper.bench.ts): building it costs what
// its queries save. It was dropped, with its two query-count tests; what stays pins the results.
describe('PR2 snap candidates acceptance', () => {
  it('matches fresh live queries across seeded boards, moves, and crowded bands', () => {
    for (const seed of [3, 17, 41]) {
      const crowd = Array.from({ length: 96 }, (unused, n) =>
        rect(`crowd-${String(seed)}-${String(n).padStart(3, '0')}`, null, {
          x: 150 + ((n * seed) % 7) / 4,
          y: 600 + n * 11,
          width: 20,
          height: 10,
        }),
      );
      const objects = [...selectBoardObjects(), ...crowd];
      const { snapper } = harness(objects);
      for (const x of [47, 48, 49, 50, 51, 52]) {
        const live = snapTransform(move(x, 0), {
          settings: view().settings,
          viewport: VIEWPORT,
          isSuspended: false,
          index: indexOf(objects),
          source: mapSource(objects),
          movingIds: new Set([id('rect-a')]),
          start: START,
          zoom: 1,
        });
        expect(snapper.snap(move(x, 0), [id('rect-a')], START)).toEqual(live.intent);
        expect(snapper.guides).toEqual(live.guides);
      }
    }
  });

  it('breaks equal-distance ties at the 64-candidate boundary by id', () => {
    // All 80 x-lines tie. The 64 smallest ids win regardless of the search order.
    const crowd = Array.from({ length: 80 }, (unused, n) =>
      rect(`tie-${String(n).padStart(2, '0')}`, null, {
        x: 151,
        y: 100 + n * 12,
        width: 20,
        height: 10,
      }),
    );
    const ids = crowd.map((object) => object.id);
    const source = mapSource(crowd);
    const box = { minX: 50, minY: 0, maxX: 147, maxY: 50 };
    const query = { viewport: VIEWPORT, thresholdWorld: 6 };
    const candidates = (ordered: ObjectId[]) =>
      snapCandidatesNear(
        { searchRect: (band) => (band.minX > -1000 ? ordered : []) },
        source,
        box,
        new Set(),
        query,
      )
        .map(({ minY }) => minY)
        .sort((a, b) => a - b);
    const expected = crowd
      .slice(0, 64)
      .map((object) => object.y)
      .sort((a, b) => a - b);
    expect(candidates(ids)).toEqual(expected);
    expect(candidates([...ids].reverse())).toEqual(expected);
  });

  it('refreshes a moved neighbour after documentChanged', () => {
    const store = createSelectStore();
    const index = indexOf(selectBoardObjects());
    store.subscribe((changes) =>
      index.apply({ ...changes, get: (key: ObjectId) => store.get(key) }),
    );
    const snapper = new DragSnapper(index, storeSource(store));
    snapper.follow(POINTER, 1, view());
    expect(snapper.snap(move(47, 0), [id('rect-a')], START)).toMatchObject({ delta: { x: 50 } });
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-b'), { x: 220 });
    });
    changed(snapper);
    expect(snapper.snap(move(67, 0), [id('rect-a')], START)).toMatchObject({ delta: { x: 70 } });
  });

  it('makes live band queries over 4000 viewport ids without changing results', () => {
    const objects = [
      ...selectBoardObjects(),
      ...Array.from({ length: 4001 }, (unused, n) =>
        rect(`far-${String(n)}`, null, {
          x: 1000 + (n % 50),
          y: 1000 + Math.floor(n / 50) * 10,
          width: 2,
          height: 2,
        }),
      ),
    ];
    const { snapper, queries } = harness(objects);
    const live = harness(objects).snapper;
    expect(snapper.snap(move(47, 0), [id('rect-a')], START)).toEqual(
      live.snap(move(47, 0), [id('rect-a')], START),
    );
    const afterFirst = queries();
    expect(snapper.snap(move(48, 0), [id('rect-a')], START)).toEqual(
      harness(objects).snapper.snap(move(48, 0), [id('rect-a')], START),
    );
    expect(queries() - afterFirst).toBe(6);
  });
});

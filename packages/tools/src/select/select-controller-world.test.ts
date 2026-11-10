import { describe, expect, it } from 'vitest';

import type { CommandError, DocumentStore } from '@canvas/document';
import { BOARD_BOUND, type BoardObject, type ObjectId, type Point } from '@canvas/schema';

import { frame, group, id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { FarSkip } from './far-objects.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// Fix round 3: "far" is decided by an object's box on the board (its extents past the
// bound, or not computable), by one function the commands and the fuzz share. An honest group of
// two frames at the edges is near and drags; an object whose box reaches past the bound is far and
// skipped with the notice rather than sent to a refusal (N2, N3); and the far test runs once per
// gesture, not on every pointer move (N6).

const B = BOARD_BOUND;

/**
 * A store whose reverse index of children counts its queries.
 *
 * @param objects - The board.
 * @returns The store, and the number of `childrenOf` queries so far.
 */
function countingStore(objects: readonly BoardObject[]) {
  const store = createSelectStore(objects);
  let queries = 0;
  const childrenOf = (parentId: ObjectId | null) => {
    queries += 1;
    return store.references.childrenOf(parentId);
  };
  const counted = new Proxy(store, {
    get(target, key) {
      if (key === 'references') return { ...target.references, childrenOf };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as DocumentStore;
  return { store: counted, queries: () => queries };
}

/**
 * A controller over a board, with what it reports collected.
 *
 * @param objects - The board.
 * @returns The store, the controller, the reports, pointer helpers and the query count.
 */
function setUp(objects: readonly BoardObject[]) {
  const { store, queries } = countingStore(objects);
  const index = indexOf(objects);
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const skips: FarSkip[] = [];
  const refusals: (readonly CommandError[])[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onFarSkipped: (skip) => skips.push(skip),
    onCommandRefused: (errors) => refusals.push(errors),
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    controller.handle(
      { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
      1,
    );
  };
  const drag = (from: Point, to: Point) => {
    at('pointerDown', from);
    at('pointerMove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    at('pointerMove', to);
    at('pointerUp', to);
  };
  return { store, controller, skips, refusals, at, drag, queries };
}

/**
 * A group at -B holding two frames 100 wide, at the left and right edges of the bound: the right
 * one stores 2B - 100, and lies on the board from B - 100 to B.
 *
 * @returns The objects.
 */
function edgeGroup(): BoardObject[] {
  return [
    group('g', null, -B, 0),
    frame('left', 'g', { x: 0, y: 0, width: 100, height: 10 }),
    frame('right', 'g', { x: 2 * B - 100, y: 0, width: 100, height: 10 }),
  ];
}

describe('N3: an honest group at the edges of the bound is near', () => {
  it('drags along the edge, with no notice and no refusal', () => {
    const { store, controller, skips, refusals, drag } = setUp(edgeGroup());
    controller.select([id('g')]);
    drag({ x: -B + 50, y: 5 }, { x: -B + 50, y: 15 });
    expect(store.get(id('g'))).toMatchObject({ x: -B, y: 10 });
    expect(skips).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it('its right frame, stored 2B from the group, moves inward', () => {
    const { store, controller, skips, refusals } = setUp(edgeGroup());
    controller.select([id('right')]);
    // A press at 2^30 is hit-tested in float32 by the engine; the arrow keys move it the same way.
    controller.handle({ kind: 'nudge', direction: 'left', isLarge: true }, 1);
    expect(store.get(id('right'))).toMatchObject({ x: 2 * B - 110 });
    expect(skips).toEqual([]);
    expect(refusals).toEqual([]);
  });
});

describe('N2: an object whose box reaches past the bound is far', () => {
  const objects = [
    rect('near', null, { x: 0, y: 0, width: 100, height: 50 }),
    // Its origin is inside the bound, its far edge 90 past it.
    rect('edge', null, { x: B - 10, y: 0, width: 100, height: 50 }),
  ];

  it('a nudge skips it with the notice, and refuses nothing', () => {
    const { store, controller, skips, refusals } = setUp(objects);
    controller.select([id('edge')]);
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: false }, 1);
    expect(store.get(id('edge'))).toMatchObject({ x: B - 10 });
    expect(skips).toEqual([{ ids: ['edge'], isEvery: true }]);
    expect(refusals).toEqual([]);
  });

  it('a turn of the selection turns the near object about its own frame and skips it', () => {
    const { store, controller, skips, refusals, drag } = setUp(objects);
    controller.select(['near', 'edge'].map(id));
    // The frame is round the near object only; its top-left rotation band is just outside.
    expect(controller.overlay().frame).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
    drag({ x: -8, y: -8 }, { x: 120, y: -8 });
    expect(store.get(id('near'))?.rotation).not.toBe(0);
    expect(store.get(id('edge'))).toMatchObject({ x: B - 10, rotation: 0 });
    expect(skips).toEqual([{ ids: ['edge'], isEvery: false }]);
    expect(refusals).toEqual([]);
  });
});

describe('N6: the far test runs once per gesture', () => {
  it('pointer moves of a drag do not test the selection again', () => {
    // 200 rectangles at the root: moving them previews each, and reads no object's children.
    const objects = [...Array(200).keys()].map((index) =>
      rect(`r${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
    );
    const { controller, at, queries } = setUp(objects);
    controller.select(objects.map((object) => object.id));
    at('pointerDown', { x: 5, y: 5 });
    at('pointerMove', { x: 15, y: 5 });
    const afterFirstMove = queries();
    for (let step = 2; step <= 11; step += 1) at('pointerMove', { x: 5 + step * 10, y: 5 });
    // The far test reads each selected object's children; ten more moves read none.
    expect(queries() - afterFirstMove).toBe(0);
    at('pointerUp', { x: 115, y: 5 });
  });
});

describe('m2: a selected frame becomes far when a peer moves its child past the bound', () => {
  it('the next transform skips it, without waiting for the selection to change', () => {
    const objects = [
      frame('f', null, { x: 0, y: 0, width: 200, height: 100 }),
      rect('inside', 'f', { x: 10, y: 10, width: 20, height: 20 }),
    ];
    const { store, controller, skips } = setUp(objects);
    controller.select([id('f')]);
    // The far test is worked out and kept (the frame and its handles are drawn).
    expect(controller.overlay().frame).toMatchObject({ x: 0, width: 200 });
    // A peer's change puts the child past the bound; the store does not judge it.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('inside'), { x: 1e300 });
    });
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: false }, 1);
    expect(store.get(id('f'))).toMatchObject({ x: 0 });
    expect(skips).toEqual([{ ids: ['f'], isEvery: true }]);
  });
});

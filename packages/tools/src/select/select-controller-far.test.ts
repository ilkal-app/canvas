import { describe, expect, it } from 'vitest';

import type { CommandError } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { rect, id, indexOf } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { FarSkip } from './far-objects.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select tool with a selection that holds far objects: the transform applies to the
// near objects, skips the far ones, tells the shell once, and the document refuses nothing;
// delete still takes the far object too.

const OBJECTS = [
  rect('rect-near', null, { x: 0, y: 0, width: 100, height: 50 }),
  rect('rect-far', null, { x: 1e300, y: 0, width: 100, height: 50 }),
];

/**
 * A controller over the near-and-far board, with what it reports collected.
 *
 * @returns The store, the controller, the reports and a pointer helper.
 */
function setUp() {
  const store = createSelectStore(OBJECTS);
  const index = indexOf(OBJECTS);
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
  return { store, controller, skips, refusals, drag };
}

describe('SelectController: a selection of near and far objects', () => {
  it('drags the near object, leaves the far one, and tells the shell once, with no refusal', () => {
    const { store, controller, skips, refusals, drag } = setUp();
    controller.select(['rect-near', 'rect-far'].map(id));
    drag({ x: 50, y: 25 }, { x: 70, y: 45 });
    expect(store.get(id('rect-near'))).toMatchObject({ x: 20, y: 20 });
    expect(store.get(id('rect-far'))).toMatchObject({ x: 1e300, y: 0 });
    expect(skips).toEqual([{ ids: ['rect-far'], isEvery: false }]);
    expect(refusals).toEqual([]);
  });

  it('draws the frame round the near object only', () => {
    const { controller } = setUp();
    controller.select(['rect-near', 'rect-far'].map(id));
    expect(controller.overlay().frame).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('offers no frame for a lone far object', () => {
    const { controller } = setUp();
    controller.select([id('rect-far')]);
    expect(controller.overlay().frame).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import type { CommandError } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { rect, id, indexOf } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { FarSkip } from './far-objects.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select tool with a selection that holds a far object and one the engine does not
// draw: one rule (`isLeftOutOfTransforms`) leaves both where they are, the honest one
// moves, and the document refuses nothing; Delete takes all three.

const HONEST = id('rect-honest');
const FAR = id('rect-far');
const UNDRAWN = id('rect-undrawn');

const OBJECTS = [
  rect('rect-honest', null, { x: 0, y: 0, width: 100, height: 50 }),
  rect('rect-far', null, { x: 1e300, y: 0, width: 100, height: 50 }),
  rect('rect-undrawn', null, { x: 300, y: 0, width: 100, height: 50 }),
];

/**
 * A controller over the board, the hit gate holding rect-undrawn undrawable.
 *
 * @returns The store, the controller, the refusals and a drag helper.
 */
function setUp() {
  const store = createSelectStore(OBJECTS);
  const index = indexOf(OBJECTS);
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const refusals: (readonly CommandError[])[] = [];
  const skips: FarSkip[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    isDrawable: (key) => key !== UNDRAWN,
    onCommandRefused: (errors) => refusals.push(errors),
    onFarSkipped: (skip) => skips.push(skip),
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
  return { store, controller, refusals, skips, drag };
}

describe('SelectController: a selection with a far and an undrawable object', () => {
  it('moves the honest object and leaves both others where they are, refusing nothing', () => {
    const { store, controller, refusals, skips, drag } = setUp();
    controller.select([HONEST, FAR, UNDRAWN]);
    drag({ x: 10, y: 10 }, { x: 40, y: 30 });
    expect(refusals).toEqual([]);
    // One notice counting both left-out objects, the far one and the undrawable one.
    expect(skips).toEqual([{ ids: [FAR, UNDRAWN], isEvery: false }]);
    expect(store.get(HONEST)).toMatchObject({ x: 30, y: 20 });
    expect(store.get(FAR)).toMatchObject({ x: 1e300, y: 0 });
    expect(store.get(UNDRAWN)).toMatchObject({ x: 300, y: 0 });
  });

  it('nudges the honest object alone, and deletes all three', () => {
    const { store, controller, refusals, skips } = setUp();
    controller.select([HONEST, FAR, UNDRAWN]);
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: false }, 1);
    expect(refusals).toEqual([]);
    expect(store.get(HONEST)).toMatchObject({ x: 1, y: 0 });
    expect(store.get(UNDRAWN)).toMatchObject({ x: 300, y: 0 });
    expect(skips.map((skip) => skip.ids.length)).toEqual([2]);
    // Delete leaves nothing out, so it gives no notice.
    controller.deleteSelection();
    expect(skips.map((skip) => skip.ids.length)).toEqual([2]);
    expect([HONEST, FAR, UNDRAWN].map((key) => store.get(key))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

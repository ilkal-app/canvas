import { expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

it('refreshes snap candidates through the controller subscription when a peer moves a neighbour mid-drag', () => {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => index.apply({ ...changes, get: (key: ObjectId) => store.get(key) }));
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    snapIndex: index,
  });
  const camera = {
    x: -1000,
    y: -1000,
    zoom: 1,
    viewportWidthPx: 3000,
    viewportHeightPx: 3000,
    dpr: 1,
  };
  const settings = { isEnabled: true, isGridVisible: false };
  const at = (kind: 'pointerDown' | 'pointerMove', point: Point) => {
    controller.handle(
      {
        kind,
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
      },
      1,
      camera,
      settings,
    );
  };
  at('pointerDown', { x: 50, y: 25 });
  at('pointerMove', { x: 97, y: 25 });
  expect(controller.frame()).toMatchObject({ x: 50 });
  store.transact(ADA, (transaction) => {
    transaction.patchObject(id('rect-b'), { x: 220 });
  });
  at('pointerMove', { x: 117, y: 25 });
  expect(controller.frame()).toMatchObject({ x: 70 });
  expect(controller.overlay().guides).toContainEqual({
    axis: 'x',
    position: 170,
    from: 0,
    to: 100,
  });
});

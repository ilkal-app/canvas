import { afterEach, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture() {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => index.apply({ ...changes, get: (key) => store.get(key) }));
  const refused = vi.fn();
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onCommandRefused: refused,
  });
  cleanups.push(
    () => {
      controller.destroy();
    },
    () => {
      store.destroy();
    },
  );
  controller.select([id('rect-a')]);
  const frame = controller.frame();
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    controller.handle(
      { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
      1,
    );
  };
  at('pointerDown', { x: 10, y: 10 });
  return { store, controller, frame, at, refused };
}

it('reuses the unchanged document frame after cancelling a preview', () => {
  const { controller, frame, at } = fixture();
  at('pointerMove', { x: 110, y: 110 });
  controller.handle({ kind: 'escape' }, 1);
  expect(controller.frame()).toBe(frame);
});

it('restores the unchanged document frame when the command is refused', () => {
  const { controller, store, frame, at, refused } = fixture();
  const before = store.encodeState();
  at('pointerMove', { x: 2e9, y: 2e9 });
  at('pointerUp', { x: 2e9, y: 2e9 });
  expect(refused).toHaveBeenCalledOnce();
  expect(store.encodeState()).toEqual(before);
  expect(controller.frame()).toBe(frame);
});

it('uses peer position and reparenting received after the last preview', () => {
  const { controller, store, at } = fixture();
  at('pointerMove', { x: 30, y: 40 });
  store.transact(SYSTEM_ORIGIN, (tx) => {
    tx.patchObject(id('rect-a'), { parentId: id('frame-f'), x: 10, y: 20 });
  });
  at('pointerUp', { x: 30, y: 40 });
  expect(store.get(id('rect-a'))).toMatchObject({ parentId: 'frame-f', x: 30, y: 50 });
  expect(controller.frame()).toMatchObject({ x: 430, y: 50 });
});

it('can cancel safely after a release source read fails', () => {
  const { controller, store, frame, at } = fixture();
  at('pointerMove', { x: 30, y: 40 });
  const read = store.get.bind(store);
  const spy = vi.spyOn(store, 'get').mockImplementation((key: ObjectId) => {
    if (key === id('rect-a')) throw new Error('source failed');
    return read(key);
  });
  expect(() => {
    at('pointerUp', { x: 30, y: 40 });
  }).toThrow('source failed');
  spy.mockRestore();
  controller.handle({ kind: 'escape' }, 1);
  expect(controller.frame()).toEqual(frame);
  expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
});

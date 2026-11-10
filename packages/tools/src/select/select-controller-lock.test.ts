import { describe, expect, it } from 'vitest';

import { runCommand, setLockedCommand, type ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select tool and locked objects: a locked object is
// clicked into the selection but never marqueed, moved, resized or rotated, and its overlay shows
// the lock instead of handles.

function setUp() {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
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
  return { store, controller, changeSets, at, drag };
}

// rect-locked: 50 × 50 at (800, 0).
const LOCKED_FRAME = { x: 800, y: 0, width: 50, height: 50, rotation: 0 };

describe('SelectController: locked objects', () => {
  it('selects a locked object on click and shows it locked, with no handles', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: 820, y: 20 });
    at('pointerUp', { x: 820, y: 20 });
    expect(controller.selection.ids).toEqual(['rect-locked']);
    expect(controller.overlay()).toMatchObject({
      frame: LOCKED_FRAME,
      canResize: false,
      isLocked: true,
    });
  });

  it('does not move a dragged locked object, and keeps its frame in place', () => {
    const { controller, changeSets, drag } = setUp();
    controller.select([id('rect-locked')]);
    drag({ x: 820, y: 20 }, { x: 920, y: 120 });
    expect(controller.overlay().frame).toEqual(LOCKED_FRAME);
    expect(changeSets).toEqual([]);
  });

  it('shows no drag frame mid-drag of a locked object', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-locked')]);
    at('pointerDown', { x: 820, y: 20 });
    at('pointerMove', { x: 900, y: 100 });
    expect(controller.overlay().frame).toEqual(LOCKED_FRAME);
    at('pointerUp', { x: 900, y: 100 });
  });

  it('offers no rotation band on a locked selection', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-locked')]);
    at('pointerMove', { x: 792, y: -8 });
    expect(controller.cursor).toBe('default');
    controller.select([id('rect-a')]);
    at('pointerMove', { x: -8, y: -8 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
  });

  it('leaves a locked object out of a marquee', () => {
    const { controller, drag } = setUp();
    drag({ x: 750, y: -50 }, { x: 900, y: 100 });
    expect(controller.selection.ids).toEqual([]);
  });

  it('shows the lock as soon as the selection is locked, and drops it on unlock', () => {
    const { store, controller } = setUp();
    controller.select([id('rect-a')]);
    expect(controller.overlay()).toMatchObject({ canResize: true, isLocked: false });
    runCommand(store, ADA, setLockedCommand, { ids: ['rect-a'], locked: true }, ENVIRONMENT);
    expect(controller.overlay()).toMatchObject({ canResize: false, isLocked: true });
    runCommand(store, ADA, setLockedCommand, { ids: ['rect-a'], locked: false }, ENVIRONMENT);
    expect(controller.overlay()).toMatchObject({ canResize: true, isLocked: false });
  });

  it('moves the unlocked part of a mixed selection and shows it unlocked', () => {
    const { store, controller, drag } = setUp();
    controller.select([id('rect-a'), id('rect-locked')]);
    expect(controller.overlay().isLocked).toBe(false);
    drag({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 20, y: 0 });
    expect(store.get(id('rect-locked'))).toMatchObject({ x: 800, y: 0 });
  });
});

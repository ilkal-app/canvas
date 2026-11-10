import { describe, expect, it, vi } from 'vitest';

import { createHistory, type DocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import { id, indexOf, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { rotatePointAbout } from './oriented-box.js';
import { SelectController } from './select-controller.js';
import { rotateCursorStepOf } from './select-cursor.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select controller's cursor: hovering is constant time whatever the selection's
// size, and the resting cursor follows the frame and the camera under a still pointer.

const DEGREE = Math.PI / 180;

/**
 * A controller over a store of objects, with a step helper.
 *
 * @param objects - The board.
 * @returns The store, the controller and `at`, which feeds one pointer input at 100%.
 */
function setUp(objects: readonly BoardObject[] = selectBoardObjects()) {
  const store: DocumentStore = createSelectStore(objects);
  const index = indexOf(objects);
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
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
  return { store, controller, at };
}

/**
 * 1,000 rectangles, 40 × 25 on a 50 world-unit grid: a frame from (0, 0) to (1990, 1240).
 *
 * @returns The objects.
 */
function grid(): BoardObject[] {
  return [...Array(1000).keys()].map((index) =>
    rect(`r${String(index)}`, null, {
      x: (index % 40) * 50,
      y: Math.floor(index / 40) * 50,
      width: 40,
      height: 40,
    }),
  );
}

describe('SelectController: the cursor', () => {
  it('reads nothing from the document on a hover, however large the selection', () => {
    const objects = grid();
    const { store, controller, at } = setUp(objects);
    controller.select(objects.map(({ id: objectId }) => objectId));
    at('pointerMove', { x: 500, y: -30 });
    const reads = vi.spyOn(store, 'get');
    for (let move = 0; move < 10; move += 1) {
      at('pointerMove', { x: -8, y: -8 });
      expect(controller.cursor).toMatchObject({ kind: 'rotate' });
      at('pointerMove', { x: 500, y: -30 });
      expect(controller.cursor).toBe('default');
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it('follows a zoom under a still pointer: the band’s world size shrinks as zoom grows', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerMove', { x: 108, y: 58 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    // At 400% the band spans 1.5 to 4.5 world units from the corner; the pointer is 11.3 out.
    controller.refreshCursor({ x: 108, y: 58 }, 4);
    expect(controller.cursor).toBe('default');
    controller.refreshCursor({ x: 108, y: 58 }, 1);
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
  });

  it('keeps the rotate cursor through a drag whatever the camera does', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerDown', { x: 108, y: 58 });
    controller.refreshCursor({ x: 500, y: 500 }, 4);
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
  });

  it('follows an undo that moves the selection away from a still pointer', () => {
    const { store, controller, at } = setUp();
    const history = createHistory(store, ADA.principalId);
    controller.select([id('rect-a')]);
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 40, y: 30 });
    at('pointerUp', { x: 40, y: 30 });
    // rect a now spans (30, 20)–(130, 70); rest in the band outside its bottom-right corner.
    at('pointerMove', { x: 138, y: 78 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    history.undo();
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
    expect(controller.cursor).toBe('default');
    history.redo();
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    history.destroy();
  });

  it('after a multi-selection turn, tests the pointer against the new axis-aligned frame', () => {
    const objects = [
      rect('p', null, { x: 0, y: 0, width: 100, height: 100 }),
      rect('q', null, { x: 200, y: 0, width: 100, height: 100 }),
    ];
    const { controller, at } = setUp(objects);
    controller.select([id('p'), id('q')]);
    // From the band outside the frame's top-right corner, 45° about its centre (150, 50): the
    // release is in the band of the turned frame the drag previewed, but beside the right
    // edge of the axis-aligned box round the turned squares, (8.6, −91.4)–(291.4, 191.4).
    const band = { x: 308, y: -8 };
    const release = rotatePointAbout(band, { x: 150, y: 50 }, 45 * DEGREE);
    at('pointerDown', band);
    at('pointerMove', rotatePointAbout(band, { x: 150, y: 50 }, 20 * DEGREE));
    at('pointerMove', release);
    at('pointerUp', release);
    expect(controller.frame()?.rotation).toBe(0);
    expect(controller.cursor).toBe('default');
  });

  it('turns the resting cursor with an edit that turns the selection under a still pointer', () => {
    const { store, controller, at } = setUp();
    const stepNow = () =>
      controller.cursor === 'default' ? undefined : rotateCursorStepOf(controller.cursor.angle);
    controller.select([id('rect-a')]);
    // Rect a spans (0, 0)–(100, 50). Outside its bottom-right corner: half a turn.
    at('pointerMove', { x: 108, y: 58 });
    expect(stepNow()).toBe(12);
    // Rest where that band will be once rect a turns 30° about its top-left corner: beside the
    // unturned box, so the default cursor for now.
    const turnedBand = rotatePointAbout({ x: 108, y: 58 }, { x: 0, y: 0 }, 30 * DEGREE);
    controller.refreshCursor(turnedBand, 1);
    expect(stepNow()).toBeUndefined();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-a'), { rotation: 30 * DEGREE });
    });
    // 180° + 30°.
    expect(stepNow()).toBe(14);
  });

  it('follows a selection change made without the pointer, such as Escape', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerMove', { x: 108, y: 58 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    controller.handle({ kind: 'escape' }, 1);
    expect(controller.cursor).toBe('default');
  });
});

describe('SelectController: document changes', () => {
  /**
   * A store of `count` rectangles on a 50-unit grid, the last one unselected, with a controller
   * whose hit tester reads a static index (so nothing but the controller reads the store) and
   * every other rectangle selected, and the pointer resting in the frame's top-left band.
   *
   * @param count - How many rectangles.
   * @returns The store, the controller and the unselected rectangle's id.
   */
  function bigSelection(count: number) {
    const objects = [...Array(count).keys()].map((index) =>
      rect(`r${String(index)}`, null, {
        x: (index % 100) * 50,
        y: Math.floor(index / 100) * 50,
        width: 40,
        height: 40,
      }),
    );
    const store = createSelectStore(objects);
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
    });
    controller.select(objects.slice(0, -1).map(({ id: objectId }) => objectId));
    const point = { x: -8, y: -8 };
    controller.handle(
      {
        kind: 'pointerMove',
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
      },
      1,
    );
    const unselected = objects.at(-1)?.id ?? id('missing');
    return { store, controller, unselected };
  }

  it('does not recompute the frame or read the document for a change to an unrelated object', () => {
    const { store, controller, unselected } = bigSelection(5001);
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    const reads = vi.spyOn(store, 'get');
    const notified = vi.fn();
    store.subscribe(notified);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(unselected, { x: 9000 });
    });
    expect(notified).toHaveBeenCalledOnce();
    expect(reads).not.toHaveBeenCalled();
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
  });

  it('recomputes the frame and the resting cursor for a change to a selected object', () => {
    const { store, controller } = bigSelection(5001);
    const reads = vi.spyOn(store, 'get');
    // Moving the top-left rectangle right and down moves the frame's corner off the pointer.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('r0'), { x: 30, y: 30 });
    });
    expect(reads).toHaveBeenCalled();
    expect(controller.frame()).toMatchObject({ x: 0, y: 0 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    store.transact(ADA, (transaction) => {
      for (const column of [0, 1]) {
        for (let row = 0; row < 50; row += 1) {
          transaction.patchObject(id(`r${String(row * 100 + column)}`), { x: 5000, y: 5000 });
        }
      }
    });
    expect(controller.frame()).toMatchObject({ x: 100 });
    expect(controller.cursor).toBe('default');
  });
});

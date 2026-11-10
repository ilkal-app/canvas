import { describe, expect, it, vi } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select tool for a person who cannot edit the board (a viewer): they select to
// look, with no handles, and no press, drag or key moves, resizes or turns anything.

function setUp(isEditable = false) {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  let canEdit = isEditable;
  const onActivate = vi.fn();
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    canEdit: () => canEdit,
    onActivate,
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point, time = 0) => {
    controller.handle(
      {
        kind,
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
        timeStamp: time,
      },
      1,
    );
  };
  const drag = (from: Point, to: Point) => {
    at('pointerDown', from);
    at('pointerMove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    at('pointerMove', to);
    at('pointerUp', to);
  };
  const setEditable = (isNowEditable: boolean) => {
    canEdit = isNowEditable;
  };
  return { store, controller, changeSets, at, drag, onActivate, setEditable };
}

// rect-a: 100 × 50 at (0, 0).
const RECT_A = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };

describe('SelectController: read-only', () => {
  it('selects what is clicked, and shows its frame without handles', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: 50, y: 25 });
    at('pointerUp', { x: 50, y: 25 });
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(controller.canEdit).toBe(false);
    expect(controller.overlay()).toMatchObject({
      frame: RECT_A,
      canResize: false,
      isLocked: false,
    });
  });

  it('selects with a marquee', () => {
    const { controller, drag } = setUp();
    drag({ x: -20, y: -20 }, { x: 120, y: 70 });
    // With connector-k, which leaves rect-a's right side inside the marquee.
    expect(controller.selection.ids).toEqual(['rect-a', 'connector-k']);
  });

  it('moves nothing on a drag, shows no preview mid-drag and writes nothing on release', () => {
    const { controller, changeSets, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 100, y: 75 });
    at('pointerMove', { x: 150, y: 125 });
    expect(controller.overlay().frame).toEqual(RECT_A);
    expect(controller.source.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
    at('pointerUp', { x: 150, y: 125 });
    expect(changeSets).toEqual([]);
    expect(controller.isGesturing).toBe(false);
  });

  it('offers no resize handle and no rotation band', () => {
    const { controller, changeSets, at, drag } = setUp();
    controller.select([id('rect-a')]);
    // The south-east handle's corner, then just outside it: the rotation band.
    drag({ x: 100, y: 50 }, { x: 160, y: 110 });
    at('pointerMove', { x: 108, y: 58 });
    expect(controller.cursor).toBe('default');
    expect(changeSets).toEqual([]);
    expect(controller.overlay().frame).toEqual(RECT_A);
  });

  it('nudges nothing', () => {
    const { controller, changeSets } = setUp();
    controller.select([id('rect-a')]);
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: true }, 1);
    expect(changeSets).toEqual([]);
  });

  it('still hands a double press to the app, which decides what a viewer may open', () => {
    const { at, onActivate } = setUp();
    at('pointerDown', { x: 50, y: 25 }, 0);
    at('pointerUp', { x: 50, y: 25 }, 10);
    at('pointerDown', { x: 50, y: 25 }, 100);
    at('pointerUp', { x: 50, y: 25 }, 110);
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ type: 'activate' }));
  });

  it('edits again as soon as the person can: a drag moves in one change set', () => {
    const { controller, changeSets, drag, setEditable } = setUp();
    controller.select([id('rect-a')]);
    setEditable(true);
    expect(controller.canEdit).toBe(true);
    expect(controller.overlay().canResize).toBe(true);
    drag({ x: 50, y: 25 }, { x: 80, y: 45 });
    expect(changeSets).toHaveLength(1);
  });

  it('can edit when the option is absent', () => {
    const store = createSelectStore();
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(indexOf(selectBoardObjects()), storeSource(store)),
    });
    expect(controller.canEdit).toBe(true);
  });
});

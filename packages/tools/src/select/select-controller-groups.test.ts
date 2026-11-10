import { describe, expect, it } from 'vitest';

import { deleteObjectsCommand, runCommand, SYSTEM_ORIGIN, type ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectIntent } from './select-intent.js';

// Groups in the select controller. The select board's group-g at (0, 300) holds rect-d,
// 40 × 40 at (0, 300) on the board, and group-h at (60, 300), which holds rect-e, 40 × 40 at
// (60, 300); frame-f is 300 × 200 at (400, 0).

const G = id('group-g');
const H = id('group-h');
const D = id('rect-d');
const E = id('rect-e');

function setUp() {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const activated: SelectIntent[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onActivate: (intent) => activated.push(intent),
  });
  let time = 1000;
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    time += 50;
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
  const click = (point: Point) => {
    at('pointerDown', point);
    at('pointerUp', point);
  };
  const doubleClick = (point: Point) => {
    click(point);
    click(point);
  };
  const pause = () => (time += 1000);
  return { store, controller, changeSets, activated, at, click, doubleClick, pause };
}

describe('SelectController: entering groups', () => {
  it('enters the outermost group on a double-click, selecting the object at its level', () => {
    const { controller, changeSets, doubleClick } = setUp();
    doubleClick({ x: 70, y: 310 });
    expect(controller.enteredGroupId).toBe(G);
    expect(controller.selection.ids).toEqual([H]);
    // The overlay outlines the entered group's derived box.
    expect(controller.overlay().enteredGroup).toEqual({
      x: 0,
      y: 300,
      width: 100,
      height: 40,
      rotation: 0,
    });
    expect(changeSets).toEqual([]);
  });

  it('enters nested groups one level per double-click, and clicks act at the entered level', () => {
    const { controller, doubleClick, click, pause } = setUp();
    doubleClick({ x: 70, y: 310 });
    pause();
    doubleClick({ x: 70, y: 310 });
    expect(controller.enteredGroupId).toBe(H);
    expect(controller.selection.ids).toEqual([E]);
    pause();
    // rect-d is outside group-h but inside group-g: the click leaves one level.
    click({ x: 10, y: 310 });
    expect(controller.selection.ids).toEqual([D]);
    expect(controller.enteredGroupId).toBe(G);
  });

  it('leaves one level on Escape, selecting the group it leaves, then clears', () => {
    const { controller, doubleClick } = setUp();
    doubleClick({ x: 10, y: 310 });
    expect(controller.selection.ids).toEqual([D]);
    controller.handle({ kind: 'escape' }, 1);
    expect(controller.enteredGroupId).toBeNull();
    expect(controller.selection.ids).toEqual([G]);
    expect(controller.overlay().enteredGroup).toBeUndefined();
    controller.handle({ kind: 'escape' }, 1);
    expect(controller.selection.ids).toEqual([]);
  });

  it('leaves the group on a click outside it, selecting what was clicked', () => {
    const { controller, doubleClick, click, pause } = setUp();
    doubleClick({ x: 10, y: 310 });
    pause();
    click({ x: 10, y: 10 });
    expect(controller.enteredGroupId).toBeNull();
    expect(controller.selection.ids).toEqual(['rect-a']);
  });

  it('selects all of the entered group’s children', () => {
    const { controller, doubleClick } = setUp();
    doubleClick({ x: 10, y: 310 });
    controller.selectAll();
    expect([...controller.selection.ids].sort()).toEqual([D, H].sort());
  });

  it('moves a child inside the entered group without reparenting it, even over a frame', () => {
    const { store, controller, changeSets, doubleClick, at, pause } = setUp();
    doubleClick({ x: 10, y: 310 });
    pause();
    changeSets.length = 0;
    at('pointerDown', { x: 10, y: 310 });
    at('pointerMove', { x: 200, y: 200 });
    at('pointerMove', { x: 430, y: 100 });
    at('pointerUp', { x: 430, y: 100 });
    expect(changeSets).toHaveLength(1);
    expect(store.get(D)).toMatchObject({ parentId: G, x: 420, y: -210 });
    expect(controller.enteredGroupId).toBe(G);
  });

  it('takes the whole group into a frame when it is dragged across the frame’s edge', () => {
    const { store, click, at, pause } = setUp();
    click({ x: 10, y: 310 });
    pause();
    at('pointerDown', { x: 10, y: 310 });
    at('pointerMove', { x: 200, y: 200 });
    at('pointerMove', { x: 460, y: 60 });
    at('pointerUp', { x: 460, y: 60 });
    expect(store.get(G)?.parentId).toBe('frame-f');
    expect(store.get(D)?.parentId).toBe(G);
  });

  it('hands other activations on, and forgets a group a collaborator deletes', () => {
    const { store, controller, activated, doubleClick, pause } = setUp();
    doubleClick({ x: 10, y: 10 });
    expect(activated).toEqual([{ type: 'activate', id: 'rect-a', world: { x: 10, y: 10 } }]);
    pause();
    doubleClick({ x: 10, y: 310 });
    expect(controller.enteredGroupId).toBe(G);
    runCommand(store, SYSTEM_ORIGIN, deleteObjectsCommand, { ids: [G] }, ENVIRONMENT);
    expect(controller.enteredGroupId).toBeNull();
    expect(controller.overlay().enteredGroup).toBeUndefined();
    expect(controller.selection.ids).toEqual([]);
  });

  it('enters a group without a point by selecting its unlocked children', () => {
    const { controller } = setUp();
    controller.enterGroup(G);
    expect(controller.enteredGroupId).toBe(G);
    expect([...controller.selection.ids].sort()).toEqual([D, H].sort());
    controller.enterGroup(D);
    expect(controller.enteredGroupId).toBe(G);
  });
});

describe('SelectController: a group holding a locked object', () => {
  it('is marqueed and deleted by nothing but leaves Delete to say why; it does not move', () => {
    const { store, controller, changeSets, at, pause } = setUp();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(E, { locked: true });
    });
    changeSets.length = 0;
    at('pointerDown', { x: -20, y: 280 });
    at('pointerMove', { x: 50, y: 320 });
    at('pointerUp', { x: 50, y: 320 });
    expect(controller.selection.ids).toEqual([G]);
    expect(controller.deleteSelection()).toEqual([G]);
    expect(store.get(G)).toBeDefined();
    pause();
    at('pointerDown', { x: 10, y: 310 });
    at('pointerMove', { x: 60, y: 360 });
    at('pointerUp', { x: 60, y: 360 });
    expect(changeSets).toEqual([]);
    expect(controller.overlay().canResize).toBe(false);
  });
});

describe('SelectController: select all and a group holding a locked object', () => {
  it('selects the group, as a click and a marquee do', () => {
    const { store, controller } = setUp();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(E, { locked: true });
    });
    controller.selectAll();
    expect(controller.selection.ids).toContain(G);
    expect(controller.selection.ids).not.toContain('rect-locked');
  });
});

describe('SelectController: resizing a group', () => {
  it('resizes a selected group from a handle as one command, its children scaled', () => {
    const { store, controller, changeSets, click, at, pause } = setUp();
    click({ x: 10, y: 310 });
    expect(controller.selection.ids).toEqual([G]);
    expect(controller.overlay().canResize).toBe(true);
    pause();
    // The group's box is 100 × 40 at (0, 300): drag its east handle 100 to the right.
    at('pointerDown', { x: 100, y: 320 });
    at('pointerMove', { x: 150, y: 320 });
    at('pointerMove', { x: 200, y: 320 });
    expect(controller.source.get(E)).toMatchObject({ width: 80 });
    expect(store.get(E)).toMatchObject({ width: 40 });
    at('pointerUp', { x: 200, y: 320 });
    expect(changeSets).toHaveLength(1);
    expect(store.get(D)).toMatchObject({ x: 0, width: 80, height: 40 });
    expect(store.get(H)).toMatchObject({ x: 120 });
    expect(store.get(E)).toMatchObject({ width: 80, height: 40 });
  });
});

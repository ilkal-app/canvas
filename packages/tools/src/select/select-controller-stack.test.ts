import { describe, expect, it } from 'vitest';

import {
  deleteObjectsCommand,
  runCommand,
  type ChangeSet,
  type CommandError,
} from '@canvas/document';
import type { AutoLayout, BoardObject, ObjectId, Point } from '@canvas/schema';

import { frame, id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// Reordering a live auto-layout's children by drag. The row frame is at (100, 100),
// 300 × 100 and fixed, padding 10 and gap 10, holding a, b and c, 40 × 40 each, laid out at x 10,
// 60 and 110 in the frame: on the board, a spans 110–150, b 160–200 and c 210–250, all at y 110.

/** A fixed row, padding 10 and gap 10. */
const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 10, right: 10, bottom: 10, left: 10 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};

/**
 * The row and its children, the row a frame or a main, with more objects.
 *
 * @param options - What the row is.
 * @param options.isMain - Whether the row is a main (component) rather than a frame.
 * @param extra - More objects on the board.
 * @returns The controller, store, recorded change sets and pointer helpers.
 */
function setUp(options: { isMain?: boolean } = {}, extra: readonly BoardObject[] = []) {
  const container = frame('row', null, {
    x: 100,
    y: 100,
    width: 300,
    height: 100,
  });
  const objects = [
    options.isMain === true
      ? {
          ...Object.fromEntries(
            Object.entries(container).filter(([key]) => key !== 'clip' && key !== 'background'),
          ),
          type: 'component',
          retired: false,
          autoLayout: ROW,
        }
      : { ...container, autoLayout: ROW },
    { ...rect('a', 'row', { x: 10, y: 10, width: 40, height: 40 }), z: 'a0' },
    { ...rect('b', 'row', { x: 60, y: 10, width: 40, height: 40 }), z: 'a1' },
    { ...rect('c', 'row', { x: 110, y: 10, width: 40, height: 40 }), z: 'a2' },
    ...extra,
  ] as BoardObject[];
  const store = createSelectStore(objects);
  const index = indexOf(objects);
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const refusals: (readonly CommandError[])[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onChange: () => undefined,
    onCommandRefused: (errors) => refusals.push(errors),
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    controller.handle(
      { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
      1,
    );
  };
  const xOf = (name: string) => store.get(id(name))?.x;
  return { store, controller, changeSets, refusals, at, xOf };
}

describe('SelectController: reordering an auto-layout by drag', () => {
  it('takes a dragged child to the slot its centre is in, as one change set', () => {
    const { changeSets, at, xOf, store } = setUp();
    at('pointerDown', { x: 230, y: 130 });
    at('pointerMove', { x: 125, y: 130 });
    at('pointerUp', { x: 125, y: 130 });
    expect(changeSets).toHaveLength(1);
    // c now stacks first: c, a, b.
    expect([xOf('c'), xOf('a'), xOf('b')]).toEqual([10, 60, 110]);
    expect(store.get(id('c'))).toMatchObject({ parentId: 'row', y: 10 });
  });

  it('shows the slot as a line across the stack while dragging', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: 230, y: 130 });
    at('pointerMove', { x: 175, y: 130 });
    // c's centre at 75 in the frame: past a (30), before b (80); the line halfway between a's
    // end (50) and b's start (60).
    expect(controller.overlay().insertion).toEqual({
      x: 155,
      y: 110,
      width: 0,
      height: 80,
      rotation: 0,
    });
    at('pointerMove', { x: 125, y: 130 });
    // Now 25 in the frame, before a: the line against the padding.
    expect(controller.overlay().insertion).toMatchObject({ x: 110, y: 110 });
  });

  it('leaves the stack as a plain move when the child is dropped outside it', () => {
    const { at, store } = setUp();
    at('pointerDown', { x: 230, y: 130 });
    at('pointerMove', { x: 230, y: 400 });
    at('pointerUp', { x: 230, y: 400 });
    expect(store.get(id('c'))).toMatchObject({ parentId: null, x: 210, y: 380 });
  });

  it('reorders inside an auto-layout main too', () => {
    const { at, xOf, changeSets } = setUp({ isMain: true });
    at('pointerDown', { x: 230, y: 130 });
    at('pointerMove', { x: 125, y: 130 });
    at('pointerUp', { x: 125, y: 130 });
    expect(changeSets).toHaveLength(1);
    expect([xOf('c'), xOf('a'), xOf('b')]).toEqual([10, 60, 110]);
  });

  it('moves several boxes to one slot together, keeping their order, in one change set', () => {
    const { controller, at, xOf, changeSets } = setUp();
    controller.select([id('a'), id('b')]);
    // a's centre from 130 to 345, past c's (230); b's to 395, still in the row. Both go to the
    // end, a before b.
    at('pointerDown', { x: 130, y: 130 });
    at('pointerMove', { x: 345, y: 130 });
    at('pointerUp', { x: 345, y: 130 });
    expect(changeSets).toHaveLength(1);
    expect([xOf('c'), xOf('a'), xOf('b')]).toEqual([10, 60, 110]);
  });

  it('drops as a plain move when the row goes before release', () => {
    const outside = { ...rect('d', null, { x: 100, y: 400, width: 40, height: 40 }), z: 'a5' };
    const { at, store, refusals } = setUp({}, [outside]);
    at('pointerDown', { x: 120, y: 420 });
    at('pointerMove', { x: 125, y: 130 });
    // The row goes (a collaborator deletes it) before release: the drag is planned again on
    // the board as it is, and d moves where it was dragged, refused nothing.
    runCommand(store, ADA, deleteObjectsCommand, { ids: ['row'] }, ENVIRONMENT);
    at('pointerUp', { x: 125, y: 130 });
    expect(store.get(id('d'))).toMatchObject({ parentId: null, x: 105, y: 110 });
    expect(refusals).toEqual([]);
  });
});

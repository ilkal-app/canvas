import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, type ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { rotatePointAbout } from './oriented-box.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectInput } from './select-input.js';

const DEGREE = Math.PI / 180;

function setUp() {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const previews: (readonly ObjectId[])[] = [];
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onChange: (previewIds) => previews.push(previewIds),
  });
  const at = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    point: Point,
    isShiftPressed = false,
    isModPressed = false,
  ) => {
    const input: SelectInput = { kind, screen: point, world: point, isShiftPressed, isModPressed };
    controller.handle(input, 1);
  };
  const drag = (from: Point, to: Point, isShiftPressed = false) => {
    at('pointerDown', from);
    at('pointerMove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, isShiftPressed);
    at('pointerMove', to, isShiftPressed);
    at('pointerUp', to, isShiftPressed);
  };
  return { store, controller, changeSets, previews, at, drag };
}

describe('SelectController: selecting', () => {
  it('selects on click and shows the frame with its handles, writing nothing', () => {
    const { controller, changeSets, at } = setUp();
    at('pointerDown', { x: 10, y: 10 });
    at('pointerUp', { x: 10, y: 10 });
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(controller.overlay()).toEqual({
      frame: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
      outlines: [],
      canResize: true,
      isLocked: false,
      marquee: undefined,
      toolRects: [],
    });
    expect(controller.selectionBounds()).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(changeSets).toEqual([]);
  });

  it('adds and removes objects with Shift-click', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerDown', { x: 175, y: 50 }, true);
    at('pointerUp', { x: 175, y: 50 }, true);
    expect(controller.selection).toEqual({ ids: ['rect-a', 'rect-b'], primaryId: 'rect-b' });
    at('pointerDown', { x: 10, y: 10 }, true);
    at('pointerUp', { x: 10, y: 10 }, true);
    expect(controller.selection.ids).toEqual(['rect-b']);
  });

  it('shows the marquee while it is dragged and outlines each object it takes', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: -10, y: 120 });
    at('pointerMove', { x: 120, y: -10 });
    expect(controller.overlay().marquee).toEqual({ minX: -10, minY: -10, maxX: 120, maxY: 120 });
    // connector-k leaves rect-a's right side at (100, 25), inside the marquee.
    expect(controller.selection.ids).toEqual(['rect-a', 'connector-k']);
    at('pointerMove', { x: 210, y: -10 });
    expect([...controller.selection.ids].sort()).toEqual(['connector-k', 'rect-a', 'rect-b']);
    expect(controller.overlay().outlines).toHaveLength(3);
    at('pointerUp', { x: 210, y: -10 });
    expect(controller.overlay().marquee).toBeUndefined();
    expect(controller.isGesturing).toBe(false);
  });

  it('draws a marquee from a frame’s background over its children, writing nothing', () => {
    const { controller, changeSets, at } = setUp();
    at('pointerDown', { x: 410, y: 10 });
    at('pointerMove', { x: 480, y: 80 });
    expect(controller.selection.ids).toEqual(['rect-c']);
    at('pointerUp', { x: 480, y: 80 });
    expect(controller.selection.ids).toEqual(['rect-c']);
    expect(changeSets).toEqual([]);
  });

  it('selects a frame by a mod+click on its background or a click on its title', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: 600, y: 150 }, false, true);
    at('pointerUp', { x: 600, y: 150 }, false, true);
    expect(controller.selection.ids).toEqual(['frame-f']);
    at('pointerDown', { x: 120, y: 20 });
    at('pointerUp', { x: 120, y: 20 });
    expect(controller.selection.ids).toEqual([]);
    at('pointerDown', { x: 600, y: -10 });
    at('pointerUp', { x: 600, y: -10 });
    expect(controller.selection.ids).toEqual(['frame-f']);
  });

  it('selects every unlocked object at the root on select all', () => {
    const { controller } = setUp();
    controller.selectAll();
    expect([...controller.selection.ids].sort()).toEqual([
      'connector-k',
      'frame-f',
      'group-g',
      'line-l',
      'path-empty',
      'rect-a',
      'rect-b',
    ]);
    expect(controller.overlay().canResize).toBe(false);
  });

  it('drops objects a collaborator deletes from the selection', () => {
    const { store, controller } = setUp();
    controller.select([id('rect-a'), id('rect-b')]);
    store.transact(SYSTEM_ORIGIN, (transaction) => transaction.deleteObject(id('rect-a')));
    expect(controller.selection.ids).toEqual(['rect-b']);
  });

  it('clears the selection on Escape', () => {
    const { controller } = setUp();
    controller.select([id('rect-a')]);
    controller.handle({ kind: 'escape' }, 1);
    expect(controller.selection.ids).toEqual([]);
    expect(controller.overlay().frame).toBeUndefined();
    expect(controller.selectionBounds()).toBeUndefined();
  });
});

describe('SelectController: transforming, one change set per gesture', () => {
  it('previews a drag without writing, then moves in one transaction on release', () => {
    const { store, controller, changeSets, previews, at } = setUp();
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 30, y: 20 });
    at('pointerMove', { x: 50, y: 30 });
    expect(controller.source.get(id('rect-a'))).toMatchObject({ x: 40, y: 20 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
    expect(controller.overlay().frame).toMatchObject({ x: 40, y: 20 });
    expect(changeSets).toEqual([]);
    at('pointerUp', { x: 60, y: 30 });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]).toMatchObject({ origin: ADA, updated: ['rect-a'] });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 50, y: 20 });
    expect(controller.source.get(id('rect-a'))).toBe(store.get(id('rect-a')));
    expect(previews).toContainEqual(['rect-a']);
    expect(controller.selection.ids).toEqual(['rect-a']);
  });

  it('restores everything and writes nothing when Escape cancels a drag', () => {
    const { store, controller, changeSets, at } = setUp();
    const before = store.get(id('rect-a'));
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 50, y: 30 });
    controller.handle({ kind: 'escape' }, 1);
    at('pointerUp', { x: 50, y: 30 });
    expect(changeSets).toEqual([]);
    expect(controller.source.get(id('rect-a'))).toBe(before);
    expect(controller.selection.ids).toEqual(['rect-a']);
  });

  it('resizes from a corner with Shift, proportionally, in one transaction', () => {
    const { store, controller, changeSets, drag } = setUp();
    controller.select([id('rect-a')]);
    drag({ x: 100, y: 50 }, { x: 150, y: 55 }, true);
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0, width: 150, height: 75 });
  });

  it('rotates from a corner band, snapped to 15° with Shift, in one transaction', () => {
    const { store, controller, changeSets, drag } = setUp();
    controller.select([id('rect-a')]);
    // The band outside rect a's bottom-right corner (100, 50), turned 40° about its centre.
    const band = { x: 108, y: 58 };
    const to = rotatePointAbout(band, { x: 50, y: 25 }, 40 * DEGREE);
    drag(band, to, true);
    expect(changeSets).toHaveLength(1);
    expect(store.get(id('rect-a'))?.rotation).toBeCloseTo(45 * DEGREE, 12);
  });

  it('asks for the rotate cursor over a corner band and through the rotation it starts', () => {
    const { controller, at } = setUp();
    controller.select([id('rect-a')]);
    expect(controller.cursor).toBe('default');
    at('pointerMove', { x: 108, y: 58 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    at('pointerDown', { x: 108, y: 58 });
    at('pointerMove', { x: 50, y: 90 });
    expect(controller.cursor).toMatchObject({ kind: 'rotate' });
    at('pointerUp', { x: 50, y: 90 });
    at('pointerMove', { x: 50, y: 25 });
    expect(controller.cursor).toBe('default');
  });

  it('leaves out an object a collaborator deletes between the last move and the release', () => {
    const { store, controller, changeSets, at } = setUp();
    controller.select([id('rect-a'), id('rect-b')]);
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 40, y: 30 });
    store.transact(SYSTEM_ORIGIN, (transaction) => transaction.deleteObject(id('rect-b')));
    at('pointerUp', { x: 40, y: 30 });
    const userChanges = changeSets.filter(({ origin }) => origin.kind === 'user');
    expect(userChanges).toHaveLength(1);
    expect(userChanges[0]?.updated).toEqual(['rect-a']);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 30, y: 20 });
    expect(controller.selection.ids).toEqual(['rect-a']);
  });

  it('leaves out an object a collaborator locks between the last move and the release', () => {
    const { store, controller, changeSets, at } = setUp();
    controller.select([id('rect-a'), id('rect-b')]);
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 40, y: 30 });
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(id('rect-b'), { locked: true });
    });
    at('pointerUp', { x: 40, y: 30 });
    const userChanges = changeSets.filter(({ origin }) => origin.kind === 'user');
    expect(userChanges.map(({ updated }) => updated)).toEqual([['rect-a']]);
    expect(store.get(id('rect-b'))).toMatchObject({ x: 200, y: 0 });
    expect(controller.source.get(id('rect-b'))).toBe(store.get(id('rect-b')));
  });

  it('does not write for a click, or a drag that ends where it started', () => {
    const { controller, changeSets, at } = setUp();
    controller.select([id('rect-a')]);
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 40, y: 10 });
    at('pointerUp', { x: 10, y: 10 });
    expect(changeSets).toEqual([]);
  });

  it('nudges by one world unit, ten with Shift, one transaction a press', () => {
    const { store, controller, changeSets } = setUp();
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: false }, 1);
    expect(changeSets).toEqual([]);
    controller.select([id('rect-a'), id('rect-locked')]);
    controller.handle({ kind: 'nudge', direction: 'right', isLarge: false }, 1);
    controller.handle({ kind: 'nudge', direction: 'down', isLarge: true }, 1);
    expect(changeSets).toHaveLength(2);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 1, y: 10 });
    expect(store.get(id('rect-locked'))).toMatchObject({ x: 800, y: 0 });
  });

  it('deletes the selection in one transaction and forgets it', () => {
    const { store, controller, changeSets } = setUp();
    controller.select([id('frame-f'), id('rect-c'), id('rect-locked')]);
    controller.deleteSelection();
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.deleted).toEqual(['frame-f', 'rect-c']);
    expect(store.get(id('rect-locked'))).toBeDefined();
    expect(controller.selection.ids).toEqual(['rect-locked']);
    controller.select([]);
    controller.deleteSelection();
    expect(changeSets).toHaveLength(1);
  });

  it('ignores select all and delete in the middle of a drag', () => {
    const { controller, changeSets, at } = setUp();
    at('pointerDown', { x: 10, y: 10 });
    at('pointerMove', { x: 40, y: 10 });
    controller.selectAll();
    controller.deleteSelection();
    expect(controller.selection.ids).toEqual(['rect-a']);
    expect(changeSets).toEqual([]);
  });

  it('stops listening to the document when destroyed', () => {
    const { store, controller } = setUp();
    controller.select([id('rect-a')]);
    controller.destroy();
    store.transact(SYSTEM_ORIGIN, (transaction) => transaction.deleteObject(id('rect-a')));
    expect(controller.selection.ids).toEqual(['rect-a']);
  });
});

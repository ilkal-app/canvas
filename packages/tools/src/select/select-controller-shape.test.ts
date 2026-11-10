import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, Point, ShapeObject } from '@canvas/schema';

import { frame, id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectPointerType } from './select-input.js';

const SHAPE = id('outline');
const CENTRE = { x: 100, y: 80 };

function setup(overrides: Partial<ShapeObject> = {}, others: readonly BoardObject[] = []) {
  const shape: ShapeObject = {
    ...rect(SHAPE, null, { x: 0, y: 0, width: 200, height: 160 }),
    fill: null,
    stroke: { color: [0, 0, 0, 1], width: 2 },
    ...overrides,
  };
  const objects = [shape, ...others];
  const store = createSelectStore(objects);
  const index = indexOf(objects);
  store.subscribe((changes) => index.apply({ ...changes, get: (key) => store.get(key) }));
  const onActivate = vi.fn();
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    onActivate,
    canActivate: () => true,
  });
  controller.select([SHAPE]);
  const at = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    point: Point = CENTRE,
    pointerType: SelectPointerType = 'mouse',
    isShiftPressed = false,
  ) => {
    controller.handle(
      {
        kind,
        world: point,
        screen: point,
        pointerType,
        isShiftPressed,
        isModPressed: false,
        timeStamp: 100,
      },
      1,
    );
  };
  return { store, controller, at, onActivate };
}

describe('selected shape interiors', () => {
  it.each(['mouse', 'pen', 'touch'] as const)(
    'previews a %s drag and commits once on release',
    (pointerType) => {
      const { store, controller, at, onActivate } = setup();
      const changes = vi.fn();
      store.subscribe(changes);
      at('pointerDown', CENTRE, pointerType);
      at('pointerMove', { x: 140, y: 110 }, pointerType);
      expect(controller.source.get(SHAPE)).toMatchObject({ x: 40, y: 30 });
      expect(store.get(SHAPE)).toMatchObject({ x: 0, y: 0 });
      expect(changes).not.toHaveBeenCalled();
      at('pointerUp', { x: 140, y: 110 }, pointerType);
      expect(store.get(SHAPE)).toMatchObject({ x: 40, y: 30 });
      expect(changes).toHaveBeenCalledTimes(1);
      expect(onActivate).not.toHaveBeenCalled();
    },
  );

  it.each(['mouse', 'pen', 'touch'] as const)(
    'activates on a %s double press released inside',
    (pointerType) => {
      const { controller, at, onActivate } = setup();
      at('pointerDown', CENTRE, pointerType);
      at('pointerUp', CENTRE, pointerType);
      expect(controller.selection.ids).toEqual([SHAPE]);
      at('pointerDown', CENTRE, pointerType);
      expect(onActivate).not.toHaveBeenCalled();
      at('pointerUp', CENTRE, pointerType);
      expect(onActivate).toHaveBeenCalledWith(
        expect.objectContaining({ id: SHAPE, world: CENTRE, pointerType }),
      );
    },
  );

  it('cancels a touch drag without writing', () => {
    const { store, controller, at } = setup();
    const before = store.encodeState();
    at('pointerDown', CENTRE, 'touch');
    at('pointerMove', { x: 140, y: 110 }, 'touch');
    controller.handle({ kind: 'pointerCancel' }, 1);
    expect(store.encodeState()).toEqual(before);
    expect(controller.selection.ids).toEqual([SHAPE]);
  });

  it('uses the rotated box, including empty corners of nonrectangular shapes', () => {
    const { store, at } = setup({ kind: 'ellipse', rotation: Math.PI / 2 });
    at('pointerDown', { x: -20, y: 20 });
    at('pointerMove', { x: 0, y: 40 });
    at('pointerUp', { x: 0, y: 40 });
    expect(store.get(SHAPE)).toMatchObject({ x: 20, y: 20 });
  });

  it('leaves an unselected interior empty', () => {
    const { controller, at, onActivate } = setup();
    controller.select([]);
    at('pointerDown');
    at('pointerUp');
    at('pointerDown');
    at('pointerUp');
    expect(controller.selection.ids).toEqual([]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps real object hits ahead of the selection interior', () => {
    const other = rect('other', null, { x: 60, y: 40, width: 80, height: 80 });
    const { controller, at } = setup({}, [other]);
    at('pointerDown');
    at('pointerUp');
    expect(controller.selection.ids).toEqual([other.id]);
  });

  it('shift-click toggles the selected shape off', () => {
    const { controller, at } = setup();
    at('pointerDown', CENTRE, 'mouse', true);
    at('pointerUp', CENTRE, 'mouse', true);
    expect(controller.selection.ids).toEqual([]);
  });

  it('does not move a locked shape', () => {
    const { store, at } = setup({ locked: true });
    const before = store.encodeState();
    at('pointerDown');
    at('pointerMove', { x: 140, y: 110 });
    at('pointerUp', { x: 140, y: 110 });
    expect(store.encodeState()).toEqual(before);
  });
});

describe('selected interiors behind frame backgrounds', () => {
  it.each([false, true])('starts a marquee above a selected shape (multi: %s)', (isMulti) => {
    const front = { ...frame('front', null, { x: 0, y: 0, width: 200, height: 160 }), z: 'a1' };
    const other = rect('other', null, { x: 240, y: 0, width: 100, height: 160 });
    const { store, controller, at } = setup({}, [front, other]);
    if (isMulti) controller.select([SHAPE, other.id]);
    const before = store.encodeState();
    at('pointerDown');
    at('pointerMove', { x: 130, y: 100 });
    expect(controller.overlay().marquee).toEqual({ minX: 100, minY: 80, maxX: 130, maxY: 100 });
    at('pointerUp', { x: 130, y: 100 });
    expect(store.encodeState()).toEqual(before);
  });

  it.each([false, true])(
    'regression: still drags above a background frame (parent: %s)',
    (isParent) => {
      const behind = { ...frame('behind', null, { x: 0, y: 0, width: 200, height: 160 }), z: 'Zz' };
      const { controller, at } = setup({ parentId: isParent ? behind.id : null }, [behind]);
      at('pointerDown');
      at('pointerMove', { x: 130, y: 100 });
      expect(controller.overlay().marquee).toBeUndefined();
      expect(controller.source.get(SHAPE)).toMatchObject({ x: 30, y: 20 });
    },
  );
});

describe('frame background precedence across pointers and selections', () => {
  for (const pointerType of ['mouse', 'pen', 'touch'] as const) {
    for (const isMulti of [false, true]) {
      it(`passes through an unpainted frame (${pointerType}, multi: ${String(isMulti)})`, () => {
        const front = {
          ...frame('front', null, { x: 0, y: 0, width: 200, height: 160 }),
          z: 'a1',
          background: null,
        };
        const other = rect('other', null, { x: 240, y: 0, width: 100, height: 160 });
        const { store, controller, at } = setup({}, [front, other]);
        if (isMulti) controller.select([SHAPE, other.id]);
        const changes = vi.fn();
        store.subscribe(changes);
        at('pointerDown', CENTRE, pointerType);
        at('pointerMove', { x: 130, y: 100 }, pointerType);
        expect(controller.overlay().marquee).toBeUndefined();
        expect(controller.source.get(SHAPE)).toMatchObject({ x: 30, y: 20 });
        expect(changes).not.toHaveBeenCalled();
        at('pointerUp', { x: 130, y: 100 }, pointerType);
        expect(changes).toHaveBeenCalledTimes(1);
        expect(controller.source.get(SHAPE)).toMatchObject({ x: 30, y: 20 });
        if (isMulti) expect(controller.source.get(other.id)).toMatchObject({ x: 270, y: 20 });
      });

      const verb = pointerType === 'touch' ? 'pans' : 'marquees';
      it(`${verb} above a locked painted frame (${pointerType}, multi: ${String(isMulti)})`, () => {
        const front = {
          ...frame('front', null, { x: 0, y: 0, width: 200, height: 160, isLocked: true }),
          z: 'a1',
        };
        const other = rect('other', null, { x: 240, y: 0, width: 100, height: 160 });
        const { store, controller, at } = setup({}, [front, other]);
        if (isMulti) controller.select([SHAPE, other.id]);
        const selected = controller.selection.ids;
        const before = store.encodeState();
        at('pointerDown', CENTRE, pointerType);
        at('pointerMove', { x: 130, y: 100 }, pointerType);
        // A finger on the frame's background pans the view instead.
        expect(controller.overlay().marquee).toEqual(
          pointerType === 'touch' ? undefined : { minX: 100, minY: 80, maxX: 130, maxY: 100 },
        );
        at('pointerUp', { x: 130, y: 100 }, pointerType);
        expect(store.encodeState()).toEqual(before);
        if (pointerType === 'touch') expect(controller.selection.ids).toEqual(selected);
      });
    }
  }

  it.each(['Zz', 'a1'])(
    'keeps a multi-selection draggable when a frame is not above all of it (%s)',
    (z) => {
      const middle = { ...frame('middle', null, { x: 0, y: 0, width: 200, height: 160 }), z };
      const other = { ...rect('other', null, { x: 240, y: 0, width: 100, height: 160 }), z: 'a2' };
      const { controller, at } = setup({}, [middle, other]);
      controller.select([SHAPE, other.id]);
      at('pointerDown');
      at('pointerMove', { x: 130, y: 100 });
      expect(controller.overlay().marquee).toBeUndefined();
      expect(controller.source.get(SHAPE)).toMatchObject({ x: 30, y: 20 });
      expect(controller.source.get(other.id)).toMatchObject({ x: 270, y: 20 });
    },
  );

  it('lets a nested painted sibling block a selection in its ancestor frame', () => {
    const outer = frame('outer', null, { x: 0, y: 0, width: 400, height: 300 });
    const inner = { ...frame('inner', outer.id, { x: 0, y: 0, width: 200, height: 160 }), z: 'a1' };
    const { controller, at } = setup({ parentId: outer.id }, [outer, inner]);
    at('pointerDown');
    at('pointerMove', { x: 130, y: 100 });
    expect(controller.overlay().marquee).toBeDefined();
    expect(controller.source.get(SHAPE)).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps a shape draggable within two nested ancestor frames', () => {
    const outer = frame('outer', null, { x: 0, y: 0, width: 400, height: 300 });
    const inner = frame('inner', outer.id, { x: 0, y: 0, width: 200, height: 160 });
    const { controller, at } = setup({ parentId: inner.id }, [outer, inner]);
    at('pointerDown');
    at('pointerMove', { x: 130, y: 100 });
    expect(controller.overlay().marquee).toBeUndefined();
    expect(controller.source.get(SHAPE)).toMatchObject({ x: 30, y: 20 });
  });
});

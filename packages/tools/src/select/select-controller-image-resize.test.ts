import { describe, expect, it } from 'vitest';

import type { AssetId, BoardObject, Crop, ImageObject, Point } from '@canvas/schema';

import { frame, group, id, indexOf, mapSource, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { ResizeHandle } from './handle-layout.js';
import { boxPointToWorld, type OrientedBox } from './oriented-box.js';
import { FREE_RESIZE, isProportionalResize, resizeAspectOf } from './resize-aspect.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

// The select tool's resize rule for images (fix round 2, controller ruling): an image
// resizes proportionally unless Shift is held, at its drawn aspect (the crop region's), so a box
// left off it comes back to it; a selection holding an image follows it; others are unchanged.

const WHOLE: Crop = { x: 0, y: 0, width: 1, height: 1 };

/**
 * An image of a 4000 × 3000 photo.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param box - Its box in the parent's frame, and rotation.
 * @param box.x - Its x.
 * @param box.y - Its y.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param box.rotation - Its rotation, radians.
 * @param crop - Its crop.
 * @returns The image.
 */
function image(
  objectId: string,
  parentId: string | null,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  crop: Crop = WHOLE,
): ImageObject {
  const shape = rect(objectId, parentId, box);
  const { id: objectKey, x, y, rotation, z, createdBy, createdAt, updatedAt } = shape;
  return {
    id: objectKey,
    parentId: shape.parentId,
    x,
    y,
    rotation,
    z,
    locked: shape.locked,
    createdBy,
    createdAt,
    updatedAt,
    width: shape.width,
    height: shape.height,
    type: 'image',
    assetId: 'photo' as AssetId,
    crop,
    naturalSize: { width: 4000, height: 3000 },
    opacity: 1,
  };
}

/**
 * The board: a 4:3 photo; the same photo in a box a merge left at 4:1; one turned; one inside
 * a turned frame; the left half of the photo (2:3); a group holding an image; and a rectangle.
 *
 * @returns The objects, parents first.
 */
function imageBoard(): BoardObject[] {
  return [
    image('photo', null, { x: 0, y: 0, width: 400, height: 300 }),
    image('stretched', null, { x: 0, y: 1000, width: 400, height: 100 }),
    image('turned', null, { x: 1000, y: 0, width: 400, height: 300, rotation: 0.5 }),
    { ...frame('frame-f', null, { x: 2000, y: 0, width: 800, height: 800 }), rotation: 0.4 },
    image('framed', 'frame-f', { x: 100, y: 100, width: 400, height: 300 }),
    image('half', null, { x: 0, y: 2000, width: 200, height: 300 }, { ...WHOLE, width: 0.5 }),
    group('group-g', null, 3000, 3000),
    image('grouped', 'group-g', { x: 0, y: 0, width: 400, height: 300 }),
    rect('rect-r', null, { x: 600, y: 0, width: 200, height: 100 }),
    rect('rect-s', null, { x: 600, y: 200, width: 100, height: 100 }),
  ];
}

/**
 * A controller over the image board in a real store, and a drag of a selection's handle.
 *
 * @returns The store and a function that selects, drags a handle and returns the new frame.
 */
function setUp() {
  const objects = imageBoard();
  const store = createSelectStore(objects);
  const index = indexOf(objects);
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
  });
  const input = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    world: Point,
    isShift = false,
  ) => {
    controller.handle(
      { kind, screen: world, world, isShiftPressed: isShift, isModPressed: false },
      1,
    );
  };
  /**
   * Selects objects and drags a handle of their frame by a displacement along its own axes.
   *
   * @param ids - What to select.
   * @param handle - The handle.
   * @param along - The displacement in the frame's own axes, world units.
   * @param isShift - Whether Shift is held.
   * @returns The frame after the drag.
   * @throws {Error} When nothing is selected.
   */
  const drag = (
    ids: readonly string[],
    handle: ResizeHandle,
    along: Point,
    isShift = false,
  ): OrientedBox => {
    controller.select(ids.map(id));
    const from = controller.frame();
    if (from === undefined) throw new Error('Nothing selected.');
    const local = {
      x: handle.includes('w') ? 0 : handle.includes('e') ? from.width : from.width / 2,
      y: handle.includes('n') ? 0 : handle.includes('s') ? from.height : from.height / 2,
    };
    const start = boxPointToWorld(from, local);
    const end = boxPointToWorld(from, { x: local.x + along.x, y: local.y + along.y });
    input('pointerDown', start, isShift);
    input('pointerMove', end, isShift);
    input('pointerUp', end, isShift);
    const after = controller.frame();
    if (after === undefined) throw new Error('The selection went away.');
    return after;
  };
  return { store, drag };
}

describe('resizeAspectOf', () => {
  const source = mapSource(imageBoard());
  const at = (...ids: string[]) => resizeAspectOf(ids.map(id), source);

  it('keeps a lone image at its drawn aspect by default, whatever its box', () => {
    expect(at('photo')).toEqual({ isProportionalByDefault: true, aspect: 4 / 3 });
    expect(at('stretched')).toEqual({ isProportionalByDefault: true, aspect: 4 / 3 });
    expect(at('half').aspect).toBeCloseTo(2 / 3, 12);
    expect(at('framed')).toEqual({ isProportionalByDefault: true, aspect: 4 / 3 });
  });

  it('makes a selection holding an image, or a group holding one, proportional at its own aspect', () => {
    expect(at('photo', 'rect-r')).toEqual({ isProportionalByDefault: true, aspect: undefined });
    expect(at('group-g')).toEqual({ isProportionalByDefault: true, aspect: undefined });
    expect(at('rect-r', 'rect-s')).toBe(FREE_RESIZE);
    expect(at('frame-f')).toBe(FREE_RESIZE);
  });

  it('walks a group cycle once and finds no image in it', () => {
    // Two groups each the other's parent: resizing one scales no image.
    const cycle = mapSource([group('group-a', 'group-b', 0, 0), group('group-b', 'group-a', 0, 0)]);
    const { isProportionalByDefault } = resizeAspectOf([id('group-a')], {
      ...cycle,
      // A document with a cycle keeps its objects movable: nothing above them is selected.
      get: (key) => {
        const object = cycle.get(key);
        return object && { ...object, parentId: null };
      },
    });
    expect(isProportionalByDefault).toBe(false);
  });

  it('leaves a locked image, and an image of no size, to other rules', () => {
    const locked = mapSource([
      { ...image('photo', null, { x: 0, y: 0, width: 4, height: 3 }), locked: true },
    ]);
    expect(resizeAspectOf([id('photo')], locked)).toBe(FREE_RESIZE);
    const empty = mapSource([
      image('photo', null, { x: 0, y: 0, width: 4, height: 3 }, { ...WHOLE, height: 0 }),
    ]);
    expect(resizeAspectOf([id('photo')], empty)).toEqual({
      isProportionalByDefault: true,
      aspect: undefined,
    });
  });

  it('frees an image with Shift and constrains any other object with it', () => {
    const imageRule = at('photo');
    expect([isProportionalResize(imageRule, false), isProportionalResize(imageRule, true)]).toEqual(
      [true, false],
    );
    expect([
      isProportionalResize(FREE_RESIZE, false),
      isProportionalResize(FREE_RESIZE, true),
    ]).toEqual([false, true]);
  });
});

describe('SelectController: resizing images', () => {
  it('keeps an image’s aspect from a corner without Shift, and frees it with Shift', () => {
    const { drag } = setUp();
    const plain = drag(['photo'], 'se', { x: 80, y: 0 });
    expect(plain.width).toBeCloseTo(480, 9);
    expect(plain.height).toBeCloseTo(360, 9);
    const free = drag(['photo'], 'se', { x: 0, y: 140 }, true);
    expect(free.width).toBeCloseTo(480, 9);
    expect(free.height).toBeCloseTo(500, 9);
  });

  it('keeps an image’s aspect from an edge without Shift, about the centre line', () => {
    const { drag, store } = setUp();
    const plain = drag(['photo'], 'e', { x: 400, y: 0 });
    expect(plain).toMatchObject({ x: 0, y: -150, width: 800, height: 600 });
    expect(store.get(id('photo'))).toMatchObject({ x: 0, y: -150, width: 800, height: 600 });
    const free = drag(['photo'], 's', { x: 0, y: 100 }, true);
    expect(free).toMatchObject({ width: 800, height: 700 });
  });

  it('brings a box left off the image’s aspect back to it', () => {
    const { drag } = setUp();
    // 400 × 100 of a 4:3 photo: the corner dragged 20 right makes it 420 × 315.
    const restored = drag(['stretched'], 'se', { x: 20, y: 0 });
    expect(restored.width / restored.height).toBeCloseTo(4 / 3, 9);
    expect(restored.width).toBeCloseTo(420, 9);
    const half = drag(['half'], 'se', { x: 100, y: 0 });
    expect(half.width / half.height).toBeCloseTo(2 / 3, 9);
  });

  it('keeps the aspect of a turned image, and of an image in a turned frame, along their axes', () => {
    const { drag, store } = setUp();
    const turned = drag(['turned'], 'se', { x: 100, y: 0 });
    expect(turned.width).toBeCloseTo(500, 9);
    expect(turned.height).toBeCloseTo(375, 9);
    expect(turned.rotation).toBeCloseTo(0.5, 12);
    const framed = drag(['framed'], 'nw', { x: -40, y: 0 });
    expect(framed.rotation).toBeCloseTo(0.4, 12);
    const stored = store.get(id('framed'));
    expect(stored?.parentId).toBe('frame-f');
    expect(stored && 'width' in stored ? [stored.width, stored.height] : []).toEqual([
      expect.closeTo(440, 9),
      expect.closeTo(330, 9),
    ]);
    const free = drag(['framed'], 'nw', { x: -40, y: 0 }, true);
    expect(free.width / free.height).not.toBeCloseTo(4 / 3, 3);
  });

  it('resizes a selection holding an image proportionally unless Shift is held', () => {
    const { drag } = setUp();
    // photo (0–400 × 0–300) and rect-r (600–800 × 0–100): an 800 × 300 frame.
    const plain = drag(['photo', 'rect-r'], 'se', { x: 80, y: 0 });
    expect(plain.width).toBeCloseTo(880, 9);
    expect(plain.height).toBeCloseTo(330, 9);
    const free = drag(['photo', 'rect-r'], 'se', { x: 0, y: 70 }, true);
    expect(free.width).toBeCloseTo(880, 9);
    expect(free.height).toBeCloseTo(400, 9);
  });

  it('leaves other objects free without Shift and proportional with it', () => {
    const { drag } = setUp();
    // rect-r (600–800 × 0–100) and rect-s (600–700 × 200–300): a 200 × 300 frame.
    const free = drag(['rect-r', 'rect-s'], 'se', { x: 100, y: 0 });
    expect(free).toMatchObject({ width: 300, height: 300 });
    const proportional = drag(['rect-r', 'rect-s'], 'se', { x: 0, y: 150 }, true);
    expect(proportional.width / proportional.height).toBeCloseTo(1, 9);
  });
});

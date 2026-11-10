import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type CommandError } from '@canvas/document';
import type { AssetId, BoardObject, ImageObject, ObjectId, Point } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { ADA, NOW } from '../select/__fixtures__/select-store.js';
import type { SelectPointerType } from '../select/select-input.js';

import { fullImageFrame } from './crop-geometry.js';
import { CropMode, type CropModeContext } from './crop-mode.js';
import { CROP_DIM_COLOR } from './crop-overlay.js';

const PHOTO_ID = 'photo' as ObjectId;

/** A 400 × 300 photo at (100, 0), uncropped. */
const PHOTO: ImageObject = {
  id: PHOTO_ID,
  type: 'image',
  parentId: null,
  x: 100,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as ImageObject['createdBy'],
  createdAt: 1,
  updatedAt: 1,
  width: 400,
  height: 300,
  assetId: 'a'.repeat(64) as AssetId,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 4000, height: 3000 },
  opacity: 1,
};

interface Recorded {
  readonly previews: (BoardObject | undefined)[];
  readonly refusals: (readonly CommandError[])[];
  commands: number;
  exits: number;
}

/**
 * A crop mode on a store holding one image.
 *
 * @param image - The image; the photo by default.
 * @param hasCapture - Whether the context has a typing capture.
 * @returns The mode, the store and what the context recorded.
 */
function cropping(image: ImageObject = PHOTO, hasCapture = true) {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    transaction.setObject(image);
  });
  const record: Recorded = { previews: [], refusals: [], commands: 0, exits: 0 };
  const context: CropModeContext = {
    store,
    origin: ADA,
    environment: { clock: () => NOW, createId: () => 'unused' as ObjectId },
    ...(hasCapture && {
      capture: {
        command: (run: () => void) => {
          record.commands += 1;
          run();
        },
      },
    }),
    setPreview: (id, object) => {
      expect(id).toBe(image.id);
      record.previews.push(object);
    },
    onChange: () => undefined,
    requestExit: () => {
      record.exits += 1;
    },
    onCommandRefused: (errors) => {
      record.refusals.push(errors);
    },
  };
  const frame = { x: image.x, y: image.y, width: image.width, height: image.height, rotation: 0 };
  const mode = new CropMode(context, image, fullImageFrame(frame, image));
  return { mode, store, record };
}

/**
 * A pointer input at a world point, zoom 1.
 *
 * @param kind - Which input.
 * @param world - Where, world units.
 * @param pointerType - The pointer.
 * @returns The input.
 */
function at(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  world: Point,
  pointerType: SelectPointerType = 'mouse',
): ToolPointerInput {
  return {
    kind,
    world,
    screen: world,
    zoom: 1,
    isShiftPressed: false,
    isModPressed: false,
    pointerType,
  };
}

/**
 * Drags from one point to another and releases.
 *
 * @param mode - The mode.
 * @param from - Where the press is.
 * @param to - Where the release is.
 */
function drag(mode: CropMode, from: Point, to: Point): void {
  mode.onPointer(at('pointerDown', from));
  mode.onPointer(at('pointerMove', to));
  mode.onPointer(at('pointerUp', to));
}

describe('CropMode', () => {
  it('shows the whole image as a preview while cropping, and drops it when done', () => {
    // The middle half across (2000 × 3000, 2:3) in a 400 × 600 box.
    const cropped = { ...PHOTO, height: 600, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    const { mode, record } = cropping(cropped);
    expect(record.previews[0]).toMatchObject({
      crop: { x: 0, y: 0, width: 1, height: 1 },
      x: -100,
      width: 800,
      height: 600,
    });
    mode.exit();
    expect(record.previews.at(-1)).toBeUndefined();
  });

  it('shows the whole image undistorted for a crop a merge left in a box of another aspect', () => {
    // The middle half across (2:3) left in the whole photo's 400 × 300 box draws 200 × 300
    // from x = 200; the whole image extends 400 × 300 from x = 100, and so does the preview.
    const merged = { ...PHOTO, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    const { mode, record } = cropping(merged);
    expect(record.previews[0]).toMatchObject({ x: 100, y: 0, width: 400, height: 300 });
    mode.exit();
  });

  it('commits a dragged crop once, on Enter, as one setStyle with the box following', () => {
    const { mode, store, record } = cropping();
    drag(mode, { x: 100, y: 0 }, { x: 200, y: 75 });
    expect(mode.crop).toEqual({ x: 0.25, y: 0.25, width: 0.75, height: 0.75 });
    expect(store.get(PHOTO_ID)).toMatchObject({ crop: PHOTO.crop });
    expect(mode.onKey({ kind: 'enter' })).toBe(true);
    expect(record.exits).toBe(1);
    mode.exit();
    expect(record.commands).toBe(1);
    expect(store.get(PHOTO_ID)).toMatchObject({
      crop: { x: 0.25, y: 0.25, width: 0.75, height: 0.75 },
      x: 200,
      y: 75,
      width: 300,
      height: 225,
      updatedAt: NOW,
    });
  });

  it('writes nothing on Escape', () => {
    const { mode, store, record } = cropping();
    drag(mode, { x: 500, y: 300 }, { x: 400, y: 200 });
    mode.onKey({ kind: 'escape' });
    expect(record.exits).toBe(1);
    mode.exit();
    expect(record.commands).toBe(0);
    // The store settles a new root object's page as it writes it: page 1.
    expect(store.get(PHOTO_ID)).toEqual({ ...PHOTO, pageId: 'page-1' });
  });

  it('writes nothing for a crop left as it was', () => {
    const { mode, record } = cropping(PHOTO, false);
    mode.exit();
    expect(record.commands).toBe(0);
    expect(record.previews).toHaveLength(2);
  });

  it('pans the crop with the box, within the image', () => {
    const cropped = { ...PHOTO, width: 200, crop: { x: 0, y: 0, width: 0.5, height: 1 } };
    const { mode } = cropping(cropped);
    // The crop box spans x 100–300 of a whole image spanning 100–500.
    drag(mode, { x: 200, y: 150 }, { x: 1000, y: 150 });
    expect(mode.crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it('puts back the crop of the drag’s start when the pointer is taken away', () => {
    const { mode } = cropping();
    mode.onPointer(at('pointerDown', { x: 500, y: 300 }));
    mode.onPointer(at('pointerMove', { x: 400, y: 200 }));
    expect(mode.crop.width).toBeCloseTo(0.75);
    mode.onPointer({ kind: 'pointerCancel' });
    expect(mode.crop).toEqual(PHOTO.crop);
    mode.onPointer({ kind: 'pointerCancel' });
    expect(mode.crop).toEqual(PHOTO.crop);
  });

  it('commits and passes a press outside the image on to the select tool', () => {
    const { mode, store } = cropping();
    drag(mode, { x: 500, y: 150 }, { x: 300, y: 150 });
    expect(mode.onPointer(at('pointerDown', { x: -500, y: 0 }))).toEqual({
      isDone: true,
      isPassedOn: true,
    });
    mode.exit();
    expect(store.get(PHOTO_ID)).toMatchObject({ width: 200, crop: { width: 0.5 } });
  });

  it('ignores a press on the dimmed image outside the crop box', () => {
    const cropped = { ...PHOTO, width: 200, crop: { x: 0, y: 0, width: 0.5, height: 1 } };
    const { mode } = cropping(cropped);
    expect(mode.onPointer(at('pointerDown', { x: 450, y: 150 })).isDone).toBe(false);
    mode.onPointer(at('pointerMove', { x: 400, y: 150 }));
    expect(mode.crop).toEqual(cropped.crop);
  });

  it('asks for a pointer over a handle, a move cursor over the box and while dragging', () => {
    const { mode } = cropping();
    expect(mode.cursor).toBe('default');
    mode.onPointer(at('pointerMove', { x: 100, y: 0 }));
    expect(mode.cursor).toBe('pointer');
    mode.onPointer(at('pointerMove', { x: 300, y: 150 }));
    expect(mode.cursor).toBe('move');
    mode.onPointer(at('pointerMove', { x: -300, y: 150 }));
    expect(mode.cursor).toBe('default');
    mode.onPointer(at('pointerDown', { x: 500, y: 300 }, 'touch'));
    expect(mode.cursor).toBe('move');
  });

  it('takes every canvas key, so none reaches the image behind the crop', () => {
    const { mode, record } = cropping();
    expect(mode.onKey({ kind: 'delete' })).toBe(true);
    expect(mode.onKey({ kind: 'selectAll' })).toBe(true);
    expect(mode.onKey({ kind: 'nudge', direction: 'left', isLarge: false })).toBe(true);
    expect(record.exits).toBe(0);
  });

  it('moves the focused edges by arrow keys, a pixel or ten, the focus moved by select all', () => {
    const { mode, store } = cropping();
    // The bottom-right handle first: left moves the right edge in by a pixel of the 400 px image.
    expect(mode.focusedHandle).toBe('se');
    mode.onKey({ kind: 'nudge', direction: 'left', isLarge: false });
    mode.onKey({ kind: 'nudge', direction: 'up', isLarge: true });
    expect(mode.crop.width).toBeCloseTo(1 - 1 / 400, 12);
    expect(mode.crop.height).toBeCloseTo(1 - 10 / 300, 12);
    // Select all moves the focus on: the bottom edge, then round to the box, which pans.
    mode.onKey({ kind: 'selectAll' });
    expect(mode.focusedHandle).toBe('s');
    for (let press = 0; press < 3; press += 1) mode.onKey({ kind: 'selectAll' });
    expect(mode.focusedHandle).toBe('inside');
    mode.onKey({ kind: 'nudge', direction: 'right', isLarge: true });
    expect(mode.crop.x).toBeCloseTo(1 / 400, 12);
    // A press on a handle focuses it.
    mode.onPointer(at('pointerDown', { x: 100, y: 0 }));
    mode.onPointer(at('pointerUp', { x: 100, y: 0 }));
    expect(mode.focusedHandle).toBe('nw');
    mode.onKey({ kind: 'nudge', direction: 'down', isLarge: false });
    expect(mode.crop.y).toBeCloseTo(1 / 300, 12);
    mode.onKey({ kind: 'enter' });
    mode.exit();
    const photo = store.get(PHOTO_ID);
    expect(photo?.type === 'image' ? photo.crop.y : undefined).toBeCloseTo(1 / 300, 12);
  });

  it('draws the dimmed image, the crop box and its handles, sized by the zoom', () => {
    const cropped = { ...PHOTO, width: 200, crop: { x: 0, y: 0, width: 0.5, height: 1 } };
    const { mode } = cropping(cropped);
    mode.onZoom(2);
    const overlay = mode.overlay();
    expect(overlay).toMatchObject({ frame: undefined, outlines: [], canResize: false });
    const rects = overlay.toolRects ?? [];
    // One dimmed band (the right half), four outline strips, eight handles of two squares but
    // the focused one (bottom-right), drawn filled.
    expect(rects).toHaveLength(1 + 4 + 15);
    expect(rects[0]).toEqual({
      box: { x: 300, y: 0, width: 200, height: 300, rotation: 0 },
      color: CROP_DIM_COLOR,
    });
    expect(rects[1]?.box.height).toBe(0.5);
    expect(rects[5]?.box.width).toBe(4);
  });

  it('ignores a context press and a hold', () => {
    const { mode } = cropping();
    const press: ToolPointerInput = {
      kind: 'contextPress',
      world: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
    };
    expect(mode.onPointer(press)).toEqual({ isDone: false });
    expect(
      mode.onPointer({ kind: 'hold', timeStamp: 0, screen: { x: 0, y: 0 }, zoom: 1 }).isDone,
    ).toBe(false);
  });

  it('reports a crop the document refuses and writes nothing', () => {
    const { mode, store, record } = cropping();
    drag(mode, { x: 500, y: 300 }, { x: 400, y: 200 });
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(PHOTO_ID);
    });
    mode.exit();
    expect(record.refusals).toHaveLength(1);
    expect(store.get(PHOTO_ID)).toBeUndefined();
  });
});

describe('CropMode.abandon', () => {
  it('drops a dragged crop writing nothing, for a person made a viewer', () => {
    const { mode, store, record } = cropping();
    drag(mode, { x: 100, y: 0 }, { x: 200, y: 75 });
    mode.abandon();
    expect(record.commands).toBe(0);
    expect(store.get(PHOTO_ID)).toMatchObject({ crop: PHOTO.crop });
    expect(record.previews.at(-1)).toBeUndefined();
  });
});

// Where an image's state overlay goes: its box on screen, its frames composed; and the
// image objects that show a set of assets on the page shown. Rewritten from upload-badges.test's
// `badgePlacementOf` cases (the badge went from the image's bottom-left corner to over it).
import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { AssetId, Board, BoardObject, ImageObject, ObjectId, PageId } from '@canvas/schema';

import { imageObjectsOf, imageOverlayRectOf } from './image-overlay-placement.js';

const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};
const PHOTO = 'photo' as ObjectId;
const ASSET = 'a'.repeat(64) as AssetId;

/**
 * An image object.
 *
 * @param fields - Fields to set.
 * @returns The image.
 */
function image(fields: Partial<ImageObject> = {}): ImageObject {
  return {
    id: PHOTO,
    type: 'image',
    parentId: null,
    pageId: null,
    assetId: ASSET,
    x: 150,
    y: 100,
    rotation: 0,
    width: 200,
    height: 100,
    ...fields,
  } as ImageObject;
}

/**
 * A board reader over some objects.
 *
 * @param objects - The objects.
 * @returns The reader.
 */
function reader(objects: readonly BoardObject[]) {
  return { get: (id: ObjectId) => objects.find((object) => object.id === id) };
}

describe('imageOverlayRectOf', () => {
  it('covers the image on screen: its top-left corner, its size at the camera’s zoom', () => {
    expect(imageOverlayRectOf(reader([image()]), PHOTO, CAMERA)).toEqual({
      left: 100,
      top: 100,
      width: 400,
      height: 200,
      rotationDeg: 0,
    });
  });

  it('composes the frames it is in, turning with them, and is none for an object gone', () => {
    const at1 = { ...CAMERA, x: 0, y: 0, zoom: 1 };
    const frame = { id: 'frame', type: 'frame', parentId: null, x: 10, y: 20, rotation: 0 };
    const nested = image({ parentId: 'frame' as ObjectId, x: 0, y: 0 });
    expect(imageOverlayRectOf(reader([nested, frame as BoardObject]), PHOTO, at1)).toMatchObject({
      left: 10,
      top: 20,
    });
    const turned = { ...frame, rotation: Math.PI / 2 };
    const inTurned = image({ parentId: 'frame' as ObjectId, x: 5, y: 0 });
    const rect = imageOverlayRectOf(reader([inTurned, turned as BoardObject]), PHOTO, at1);
    expect(rect?.left).toBeCloseTo(10);
    expect(rect?.top).toBeCloseTo(25);
    expect(rect?.rotationDeg).toBeCloseTo(90);
    const loop = image({ parentId: PHOTO });
    expect(imageOverlayRectOf(reader([loop]), PHOTO, at1)?.top).toBe(100);
    const orphan = image({ parentId: 'gone' as ObjectId });
    expect(imageOverlayRectOf(reader([orphan]), PHOTO, CAMERA)).toBeDefined();
    expect(imageOverlayRectOf(reader([]), PHOTO, CAMERA)).toBeUndefined();
    const sticky = { ...image(), type: 'sticky' } as unknown as BoardObject;
    expect(imageOverlayRectOf(reader([sticky]), PHOTO, CAMERA)).toBeUndefined();
  });

  it('covers a shape or frame filled with an image, not an instance', () => {
    const expected = imageOverlayRectOf(reader([image()]), PHOTO, CAMERA);
    for (const type of ['shape', 'frame']) {
      const filled = { ...image(), type } as unknown as BoardObject;
      expect(imageOverlayRectOf(reader([filled]), PHOTO, CAMERA)).toEqual(expected);
    }
    for (const type of ['instance', 'line']) {
      const other = { ...image(), type } as unknown as BoardObject;
      expect(imageOverlayRectOf(reader([other]), PHOTO, CAMERA)).toBeUndefined();
    }
  });
});

describe('imageObjectsOf', () => {
  it('finds the images of the assets on the page shown', () => {
    const first = 'first' as PageId;
    const second = 'second' as PageId;
    const pages = new Map([
      [first, { id: first, name: 'One', order: 'a' }],
      [second, { id: second, name: 'Two', order: 'b' }],
    ]);
    const objects = [
      image({ id: 'one' as ObjectId, pageId: first }),
      image({ id: 'two' as ObjectId, pageId: second }),
      image({ id: 'other' as ObjectId, pageId: first, assetId: 'b'.repeat(64) as AssetId }),
      { id: 'note', type: 'sticky', pageId: first } as unknown as BoardObject,
    ];
    const board = {
      objects: new Map(objects.map((object) => [object.id, object])),
      pages,
    } as unknown as Board;
    expect(imageObjectsOf(board, [ASSET], first)).toEqual(['one']);
    expect(imageObjectsOf(board, [ASSET], second)).toEqual(['two']);
    expect(imageObjectsOf(board, [ASSET], undefined)).toEqual(['one', 'two']);
    expect(imageObjectsOf(board, [], first)).toEqual([]);
  });
});

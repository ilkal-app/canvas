import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import { MAX_FONT_SIZE, type BoardObject, type ObjectId } from '@canvas/schema';

import {
  drawerClearanceOf,
  editedBoundsOf,
  emphasisOf,
  TEXT_BAR_GAP_PX,
  TEXT_BAR_HINT_GAP_PX,
  TEXT_BAR_MARGIN_PX,
  TEXT_BAR_SIZES,
  textBarPlacementOf,
  textBarSizesOf,
} from './text-bar-model.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

describe('textBarSizesOf', () => {
  it('lists the bar’s sizes, with the edited text’s own in order', () => {
    expect(textBarSizesOf(14)).toEqual(TEXT_BAR_SIZES);
    expect(textBarSizesOf(15)).toEqual([10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 64, 96]);
    expect(textBarSizesOf(undefined)).toEqual(TEXT_BAR_SIZES);
    expect(textBarSizesOf(MAX_FONT_SIZE + 1)).toEqual(TEXT_BAR_SIZES);
  });
});

describe('emphasisOf', () => {
  it('reads bold at weight 700 and italic as stored, mixed where the style leaves them out', () => {
    const plain = { isUnderlined: false, isStruckThrough: false };
    expect(emphasisOf({ weight: 700, italic: true })).toEqual({
      bold: true,
      italic: true,
      ...plain,
    });
    expect(emphasisOf({ weight: 400, italic: false })).toEqual({
      bold: false,
      italic: false,
      ...plain,
    });
    expect(emphasisOf({})).toEqual({ bold: 'mixed', italic: 'mixed', ...plain });
  });

  it('shows underline and strikethrough pressed only when every character has them', () => {
    expect(emphasisOf({ underline: true, strikethrough: true })).toMatchObject({
      isUnderlined: true,
      isStruckThrough: true,
    });
    expect(emphasisOf({ underline: false })).toMatchObject({ isUnderlined: false });
  });
});

/** The bar and hint as the design's text-editing frame draws them: 305 and 78 px wide. */
const SIZE = { barWidthPx: 305, hintWidthPx: 78, leftClearancePx: 0, rightClearancePx: 0 };

describe('textBarPlacementOf', () => {
  it('centres the bar over the object, its bottom a gap above the top edge', () => {
    const bounds = { minX: 386, minY: 276, maxX: 566, maxY: 392 };
    expect(textBarPlacementOf(bounds, CAMERA, SIZE)).toEqual({
      left: 476 - 305 / 2,
      y: 276 - TEXT_BAR_GAP_PX,
      side: 'above',
    });
    // Zoomed and panned: screen px.
    const zoomed = textBarPlacementOf(
      bounds,
      { ...CAMERA, x: 100, y: 100, zoom: 2, viewportWidthPx: 1440 },
      SIZE,
    );
    expect(zoomed).toEqual({ left: 752 - 305 / 2, y: 352 - TEXT_BAR_GAP_PX, side: 'above' });
    // Unmeasured, its left edge is the object's centre until the page lays it out.
    expect(textBarPlacementOf(bounds, CAMERA).left).toBe(476);
  });

  it('keeps the bar and its hint on the canvas for an object at either edge', () => {
    const atLeft = { minX: -60, minY: 200, maxX: 60, maxY: 300 };
    expect(textBarPlacementOf(atLeft, CAMERA, SIZE).left).toBe(TEXT_BAR_MARGIN_PX);
    const atRight = { minX: 740, minY: 200, maxX: 860, maxY: 300 };
    const right = textBarPlacementOf(atRight, CAMERA, SIZE);
    const end = right.left + SIZE.barWidthPx + TEXT_BAR_HINT_GAP_PX + SIZE.hintWidthPx;
    expect(end).toBe(CAMERA.viewportWidthPx - TEXT_BAR_MARGIN_PX);
    // A canvas too narrow for both: the left edge wins, so the size control can be reached.
    const narrow = { ...CAMERA, viewportWidthPx: 300 };
    expect(textBarPlacementOf(atRight, narrow, SIZE).left).toBe(TEXT_BAR_MARGIN_PX);
  });

  it('keeps the bar on the board between open drawers, the left edge winning when narrow', () => {
    // The layers drawer covers 240 px on the left, the inspector 300 px on the right of a 1440 px
    // canvas: the board runs from 240 to 1140.
    const wide = { ...CAMERA, viewportWidthPx: 1440 };
    const drawers = { ...SIZE, leftClearancePx: 240, rightClearancePx: 300 };
    const underLayers = { minX: 100, minY: 200, maxX: 220, maxY: 300 };
    expect(textBarPlacementOf(underLayers, wide, drawers).left).toBe(240 + TEXT_BAR_MARGIN_PX);
    const underInspector = { minX: 1200, minY: 200, maxX: 1320, maxY: 300 };
    const right = textBarPlacementOf(underInspector, wide, drawers);
    const end = right.left + SIZE.barWidthPx + TEXT_BAR_HINT_GAP_PX + SIZE.hintWidthPx;
    expect(end).toBe(1440 - 300 - TEXT_BAR_MARGIN_PX);
    // Between the drawers, the bar stays centred on the object.
    const between = { minX: 600, minY: 200, maxX: 700, maxY: 300 };
    expect(textBarPlacementOf(between, wide, drawers).left).toBe(650 - SIZE.barWidthPx / 2);
    // A board narrower than the bar and hint: the left edge wins.
    const narrow = { ...drawers, leftClearancePx: 600, rightClearancePx: 600 };
    expect(textBarPlacementOf(underInspector, wide, narrow).left).toBe(600 + TEXT_BAR_MARGIN_PX);
  });

  it('goes below the object when there is no room above it', () => {
    const bounds = { minX: 200, minY: 10, maxX: 300, maxY: 60 };
    expect(textBarPlacementOf(bounds, CAMERA)).toEqual({
      left: 250,
      y: 60 + TEXT_BAR_GAP_PX,
      side: 'below',
    });
  });
});

describe('drawerClearanceOf', () => {
  it('reads how far open drawers reach into the canvas, none for a closed one', () => {
    const canvas = { left: 0, right: 1440 };
    expect(drawerClearanceOf(canvas, { left: 0, right: 240 }, { left: 1140, right: 1440 })).toEqual(
      { leftClearancePx: 240, rightClearancePx: 300 },
    );
    expect(drawerClearanceOf(canvas, undefined, undefined)).toEqual({
      leftClearancePx: 0,
      rightClearancePx: 0,
    });
    // A drawer outside the canvas covers nothing; one past it covers no more than the canvas.
    const offset = { left: 300, right: 1300 };
    expect(drawerClearanceOf(offset, { left: 0, right: 200 }, { left: 1400, right: 1700 })).toEqual(
      { leftClearancePx: 0, rightClearancePx: 0 },
    );
    expect(drawerClearanceOf(offset, { left: 0, right: 2000 }, undefined).leftClearancePx).toBe(
      1000,
    );
  });
});

describe('editedBoundsOf', () => {
  it('reads the edited object’s box in the world through its frames, none when gone', () => {
    const frame = { id: 'f', type: 'frame', parentId: null, x: 100, y: 50, rotation: 0 };
    const note = {
      id: 'n',
      type: 'sticky',
      parentId: 'f',
      x: 10,
      y: 20,
      rotation: 0,
      width: 176,
      height: 112,
    };
    const objects = [frame, note] as unknown as BoardObject[];
    const board = { get: (key: ObjectId) => objects.find((object) => object.id === key) };
    // The note's own box, not the shadow the engine's culling bounds take in.
    expect(editedBoundsOf(board, 'n' as ObjectId)).toEqual({
      minX: 110,
      minY: 70,
      maxX: 286,
      maxY: 182,
    });
    expect(editedBoundsOf(board, 'gone' as ObjectId)).toBeUndefined();
  });
});

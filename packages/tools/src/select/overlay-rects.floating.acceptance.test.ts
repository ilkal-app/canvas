import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';
import { HANDLE_EDGE_PX, SELECTION_FRAME_GAP_PX, SELECTION_FRAME_WIDTH_PX } from '@canvas/tools';

import { countBadgeLayout } from './count-badge.js';
import { handleLayout } from './handle-layout.js';
import { boxPointToWorld, type OrientedBox } from './oriented-box.js';
import { dashedOutlineOf, gapRunOf, outlineOf } from './overlay-marks.js';
import type { OverlayPalette } from './overlay-palette.js';
import {
  EMPTY_OVERLAY,
  ENTERED_GROUP_COLOR,
  HANDLE_FILL,
  LOCKED_COLOR,
  overlayRectsOf,
  SELECTION_COLOR,
} from './overlay-rects.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
const COLOR: Rgba = [183 / 255, 128 / 255, 28 / 255, 1];
const SHEET: Rgba = [243 / 255, 242 / 255, 238 / 255, 1];
const PALETTE: OverlayPalette = {
  you: COLOR,
  guide: [0.8, 0.2, 0.1, 1],
  hover: [0.3, 0.4, 0.5, 1],
  locked: [0.5, 0.5, 0.5, 1],
  selection: { color: COLOR, frameColor: COLOR, handleFill: SHEET },
};
const CLASSIC_PALETTE: OverlayPalette = {
  you: PALETTE.you,
  guide: PALETTE.guide,
  hover: PALETTE.hover,
  locked: PALETTE.locked,
};

const model = { ...EMPTY_OVERLAY, frame: FRAME, canResize: true, palette: PALETTE };

function box(x: number, y: number, width: number, height: number, rotation = 0): OrientedBox {
  return { x, y, width, height, rotation };
}

describe('floating selection overlay', () => {
  it.each([1, 2])(
    'keeps the frame gap, stroke and every handle screen sized at zoom %i',
    (zoom) => {
      const px = 1 / zoom;
      const rects = overlayRectsOf(model, zoom);
      const outer = 4 * px;
      const gap = 2 * px;
      const stroke = 2 * px;
      expect(rects.slice(0, 4)).toEqual([
        { box: box(100 - outer, 100 - outer, 200 + 2 * outer, stroke), color: COLOR },
        { box: box(100 - outer, 200 + gap, 200 + 2 * outer, stroke), color: COLOR },
        { box: box(100 - outer, 100 - gap, stroke, 100 + 2 * gap), color: COLOR },
        { box: box(300 + gap, 100 - gap, stroke, 100 + 2 * gap), color: COLOR },
      ]);
      expect(rects).toHaveLength(20);
      const centres = [
        [100 - 3 * px, 100 - 3 * px],
        [300 + 3 * px, 100 - 3 * px],
        [300 + 3 * px, 200 + 3 * px],
        [100 - 3 * px, 200 + 3 * px],
        [200, 100 - 3 * px],
        [300 + 3 * px, 150],
        [200, 200 + 3 * px],
        [100 - 3 * px, 150],
      ];
      for (const [index, centre] of centres.entries()) {
        const [cx = 0, cy = 0] = centre;
        const outerSide = 8 * px;
        const innerSide = 5 * px;
        expect(rects.slice(4 + index * 2, 6 + index * 2)).toEqual([
          {
            box: box(cx - outerSide / 2, cy - outerSide / 2, outerSide, outerSide),
            color: COLOR,
          },
          {
            box: box(cx - innerSide / 2, cy - innerSide / 2, innerSide, innerSide),
            color: SHEET,
          },
        ]);
      }
      expect(SELECTION_FRAME_GAP_PX).toBe(2);
      expect(SELECTION_FRAME_WIDTH_PX).toBe(2);
      expect(HANDLE_EDGE_PX).toBe(1.5);
    },
  );

  it('places a turned handle three screen pixels out along both frame axes', () => {
    const turned = { ...FRAME, rotation: Math.PI / 2 };
    const rects = overlayRectsOf({ ...model, frame: turned }, 1);
    const centre = boxPointToWorld(turned, { x: -3, y: -3 });
    expect(centre.x).toBeCloseTo(103);
    expect(centre.y).toBeCloseTo(97);
    expect(rects[4]?.box).toMatchObject({
      x: 107,
      y: 93,
      width: 8,
      height: 8,
      rotation: Math.PI / 2,
    });
    expect(rects[5]?.box).toMatchObject({
      x: 105.5,
      y: 94.5,
      width: 5,
      height: 5,
      rotation: Math.PI / 2,
    });
    expect(rects.slice(0, 4).every(({ box: strip }) => strip.rotation === Math.PI / 2)).toBe(true);
  });

  it('keeps the offered edge handles for a one-axis resize', () => {
    const rects = overlayRectsOf({ ...model, canResize: 'x' }, 1);
    expect(handleLayout(FRAME, 1, 'x').map(({ handle }) => handle)).toEqual(['e', 'w']);
    expect(rects.slice(4).map(({ box: handle }) => [handle.x, handle.y])).toEqual([
      [299, 146],
      [300.5, 147.5],
      [93, 146],
      [94.5, 147.5],
    ]);
  });

  it('colours each multi-selection outline, marquee, drop target, insertion and count badge', () => {
    const outlines = [box(110, 110, 30, 20), box(250, 160, 30, 20)];
    const multi = overlayRectsOf({ ...model, outlines }, 1);
    expect(multi.slice(0, 8)).toEqual(outlines.flatMap((outline) => outlineOf(outline, 1, COLOR)));
    expect(multi.slice(8, 12)).toEqual(overlayRectsOf(model, 1).slice(0, 4));
    const marquee = overlayRectsOf(
      { ...EMPTY_OVERLAY, palette: PALETTE, marquee: { minX: 10, minY: 20, maxX: 50, maxY: 60 } },
      1,
    );
    expect(marquee).toEqual([
      { box: box(10, 20, 40, 40), color: [COLOR[0], COLOR[1], COLOR[2], 32 / 255] },
      ...outlineOf(box(10, 20, 40, 40), 1, COLOR),
    ]);
    expect(overlayRectsOf({ ...EMPTY_OVERLAY, palette: PALETTE, dropTarget: FRAME }, 1)).toEqual(
      outlineOf(FRAME, 1, COLOR),
    );
    expect(
      overlayRectsOf({ ...EMPTY_OVERLAY, palette: PALETTE, insertion: box(155, 110, 0, 80) }, 2),
    ).toEqual([{ box: box(154.5, 110, 1, 80), color: COLOR }]);
    const badge = countBadgeLayout(FRAME, 600, 1);
    expect(overlayRectsOf({ ...model, countBadge: 600 }, 1)[20]).toEqual({
      box: badge.badge,
      color: COLOR,
    });
  });

  it('leaves hover, group, guides, gap runs and locked selection as before', () => {
    const hover = box(400, 100, 50, 40);
    const group = box(0, 0, 500, 300);
    const guides = [{ axis: 'y', position: 120, from: 0, to: 400 }] as const;
    const gaps = [{ axis: 'x', from: 76, to: 100, position: 150 }] as const;
    const rects = overlayRectsOf({ ...model, hover, enteredGroup: group, guides, gaps }, 1);
    expect(rects.slice(0, 8)).toEqual([
      ...outlineOf(group, 1, ENTERED_GROUP_COLOR),
      ...outlineOf(hover, 1, PALETTE.hover),
    ]);
    expect(rects.slice(12, 16)).toEqual([
      { box: box(0, 119.5, 400, 1), color: PALETTE.guide },
      ...gapRunOf(gaps[0], 1, 1, PALETTE.guide),
    ]);
    const locked = overlayRectsOf({ ...model, isLocked: true }, 1);
    const classicLocked = overlayRectsOf({ ...model, isLocked: true, palette: CLASSIC_PALETTE }, 1);
    expect(locked).toEqual(classicLocked);
    expect(locked.slice(0, -5)).toEqual(dashedOutlineOf(FRAME, 1, 1, PALETTE.locked));
    expect(locked.at(-5)?.color).toEqual(LOCKED_COLOR);
  });

  it('preserves the exact classic rectangles when selection is absent', () => {
    const classic = { ...model, palette: CLASSIC_PALETTE };
    const withoutPalette = { ...EMPTY_OVERLAY, frame: FRAME, canResize: true };
    expect(overlayRectsOf(classic, 1)).toEqual(overlayRectsOf(withoutPalette, 1));
    const rects = overlayRectsOf(classic, 1);
    expect(rects.slice(0, 4)).toEqual(outlineOf(FRAME, 1, SELECTION_COLOR));
    expect(rects[4]).toEqual({ box: box(96, 96, 8, 8), color: SELECTION_COLOR });
    expect(rects[5]).toEqual({ box: box(97, 97, 6, 6), color: HANDLE_FILL });
  });
});

import { describe, expect, it } from 'vitest';

import { SNAP_GUIDE_COLOR } from '../snap/snap-guide.js';

import { countBadgeLayout } from './count-badge.js';
import { HANDLE_SIZE_PX } from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';
import { dashedOutlineOf, gapRunOf, outlineOf } from './overlay-marks.js';
import type { OverlayPalette } from './overlay-palette.js';
import {
  EMPTY_OVERLAY,
  ENTERED_GROUP_COLOR,
  HANDLE_FILL,
  LOCK_BADGE_GAP_PX,
  LOCK_BADGE_SIZE_PX,
  LOCKED_COLOR,
  MARQUEE_FILL,
  overlayRectsOf,
  SELECTION_COLOR,
  type SelectionOverlayModel,
} from './overlay-rects.js';
import { MAX_OUTLINED_OBJECTS } from './selection-outlines.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
const SINGLE: SelectionOverlayModel = { ...EMPTY_OVERLAY, frame: FRAME, canResize: true };

describe('overlayRectsOf', () => {
  it('draws nothing when nothing is selected or dragged', () => {
    expect(overlayRectsOf(EMPTY_OVERLAY, 1)).toEqual([]);
  });

  it('outlines the frame one pixel outside, then each resize handle, with no rotate handle', () => {
    const rects = overlayRectsOf(SINGLE, 1);
    expect(rects).toHaveLength(4 + 8 * 2);
    expect(rects.slice(0, 4).map(({ box }) => [box.x, box.y, box.width, box.height])).toEqual([
      [99, 99, 202, 1],
      [99, 200, 202, 1],
      [99, 100, 1, 100],
      [300, 100, 1, 100],
    ]);
    // Nothing above the top edge: every rectangle starts at or below the outline's top.
    expect(rects.every(({ box }) => box.y >= 100 - HANDLE_SIZE_PX / 2)).toBe(true);
    // The "se" handle, third in handle order: a blue 8 px square with a white 6 px inside.
    const half = HANDLE_SIZE_PX / 2;
    expect(rects.slice(8, 10)).toEqual([
      {
        box: { x: 300 - half, y: 200 - half, width: 8, height: 8, rotation: 0 },
        color: SELECTION_COLOR,
      },
      {
        box: { x: 300 - half + 1, y: 200 - half + 1, width: 6, height: 6, rotation: 0 },
        color: HANDLE_FILL,
      },
    ]);
  });

  it('keeps lines and handles one screen size at another zoom', () => {
    const rects = overlayRectsOf(SINGLE, 2);
    expect(rects[0]?.box).toMatchObject({ x: 99.5, y: 99.5, width: 201, height: 0.5 });
    expect(rects[4]?.box).toMatchObject({ width: HANDLE_SIZE_PX / 2, height: HANDLE_SIZE_PX / 2 });
  });

  it('turns handles and outlines with a rotated frame', () => {
    const turned = { ...FRAME, rotation: Math.PI / 2 };
    const rects = overlayRectsOf({ ...SINGLE, frame: turned }, 1);
    expect(rects.every(({ box }) => box.rotation === Math.PI / 2)).toBe(true);
    // The "nw" handle's centre is the frame's corner (100, 100); its own corner is a turned
    // (−4, −4) away: (100 + 4, 100 − 4).
    expect(rects[4]?.box.x).toBeCloseTo(104, 9);
    expect(rects[4]?.box.y).toBeCloseTo(96, 9);
  });

  it('shows only the outline when the selection cannot be resized', () => {
    expect(overlayRectsOf({ ...SINGLE, canResize: false }, 1)).toHaveLength(4);
  });

  it('outlines every object of a multi-selection under the frame', () => {
    const outlines = [
      { x: 100, y: 100, width: 50, height: 50, rotation: 0 },
      { x: 250, y: 150, width: 50, height: 50, rotation: 0 },
    ];
    const rects = overlayRectsOf({ ...SINGLE, outlines }, 1);
    expect(rects).toHaveLength(8 + 4 + 16);
    expect(rects[0]?.box).toMatchObject({ x: 99, y: 99, width: 52 });
  });

  it('draws the marquee as a translucent fill with an outline, under everything', () => {
    const rects = overlayRectsOf(
      { ...EMPTY_OVERLAY, marquee: { minX: 10, minY: 20, maxX: 50, maxY: 80 } },
      1,
    );
    expect(rects).toHaveLength(5);
    expect(rects[0]).toEqual({
      box: { x: 10, y: 20, width: 40, height: 60, rotation: 0 },
      color: MARQUEE_FILL,
    });
  });

  it('outlines the drop target one pixel outside its edges, under the selection, at any zoom', () => {
    const target = { x: 0, y: 0, width: 600, height: 400, rotation: 0.2 };
    const rects = overlayRectsOf({ ...SINGLE, dropTarget: target }, 2);
    expect(rects).toHaveLength(4 + 4 + 16);
    expect(rects.slice(0, 4).every(({ color }) => color === SELECTION_COLOR)).toBe(true);
    expect(rects.slice(0, 4).every(({ box }) => box.rotation === 0.2)).toBe(true);
    expect(rects[0]?.box).toMatchObject({ width: 601, height: 0.5 });
    // With nothing selected (a frame alone is never outlined by the overlay otherwise).
    expect(overlayRectsOf({ ...EMPTY_OVERLAY, dropTarget: target }, 1)).toHaveLength(4);
  });

  it('draws an auto-layout insertion line two pixels thick at any zoom', () => {
    const insertion = { x: 155, y: 110, width: 0, height: 80, rotation: 0 };
    const rects = overlayRectsOf({ ...EMPTY_OVERLAY, insertion }, 2);
    expect(rects).toEqual([
      { box: { x: 154.5, y: 110, width: 1, height: 80, rotation: 0 }, color: SELECTION_COLOR },
    ]);
  });

  it('draws a locked selection in the lock colour, with a lock badge and no handles', () => {
    const rects = overlayRectsOf({ ...SINGLE, isLocked: true }, 1);
    expect(rects).toHaveLength(4 + 5);
    expect(rects.slice(0, 4).every(({ color }) => color === LOCKED_COLOR)).toBe(true);
    // The badge: a square in the lock colour just right of the frame's top-right corner, with a
    // white padlock (body and shackle) on it.
    expect(rects[4]).toEqual({
      box: {
        x: 300 + LOCK_BADGE_GAP_PX,
        y: 100,
        width: LOCK_BADGE_SIZE_PX,
        height: LOCK_BADGE_SIZE_PX,
        rotation: 0,
      },
      color: LOCKED_COLOR,
    });
    expect(rects.slice(5).every(({ color }) => color === HANDLE_FILL)).toBe(true);
    const badge = rects[4]?.box;
    for (const { box } of rects.slice(5)) {
      expect(box.x).toBeGreaterThan(badge?.x ?? 0);
      expect(box.x + box.width).toBeLessThan((badge?.x ?? 0) + LOCK_BADGE_SIZE_PX);
    }
  });

  it('keeps the lock badge one screen size, turned with the frame', () => {
    const turned = { ...FRAME, rotation: Math.PI / 2 };
    const rects = overlayRectsOf({ ...SINGLE, frame: turned, isLocked: true }, 2);
    expect(rects[4]?.box).toMatchObject({
      width: LOCK_BADGE_SIZE_PX / 2,
      height: LOCK_BADGE_SIZE_PX / 2,
      rotation: Math.PI / 2,
    });
    // A quarter turn clockwise takes the top-right corner (300, 100) to (100, 300).
    expect(rects[4]?.box.x).toBeCloseTo(100, 9);
    expect(rects[4]?.box.y).toBeCloseTo(300 + LOCK_BADGE_GAP_PX / 2, 9);
  });

  it('outlines each object of a locked multi-selection in the lock colour', () => {
    const outlines = [
      { x: 100, y: 100, width: 50, height: 50, rotation: 0 },
      { x: 250, y: 150, width: 50, height: 50, rotation: 0 },
    ];
    const rects = overlayRectsOf({ ...SINGLE, outlines, isLocked: true }, 1);
    expect(rects).toHaveLength(8 + 4 + 5);
    expect(rects.slice(0, 12).every(({ color }) => color === LOCKED_COLOR)).toBe(true);
  });

  it('draws each snapping guide one pixel wide across its span, over the frame, under the handles', () => {
    const guides = [
      { axis: 'x', position: 100, from: -50, to: 200 },
      { axis: 'y', position: 150, from: 0, to: 300 },
    ] as const;
    const rects = overlayRectsOf({ ...SINGLE, guides }, 2);
    expect(rects).toHaveLength(4 + 2 + 16);
    expect(rects.slice(4, 6)).toEqual([
      {
        box: { x: 99.75, y: -50, width: 0.5, height: 250, rotation: 0 },
        color: SNAP_GUIDE_COLOR,
      },
      {
        box: { x: 0, y: 149.75, width: 300, height: 0.5, rotation: 0 },
        color: SNAP_GUIDE_COLOR,
      },
    ]);
    expect(overlayRectsOf({ ...SINGLE, guides: [] }, 1)).toHaveLength(4 + 16);
  });

  it('shows a capped selection as its frame, its handles and a count badge on top', () => {
    const rects = overlayRectsOf({ ...SINGLE, countBadge: 600 }, 1);
    const { badge, segments } = countBadgeLayout(FRAME, 600, 1);
    expect(rects).toHaveLength(4 + 16 + 1 + segments.length);
    expect(rects[20]).toEqual({ box: badge, color: SELECTION_COLOR });
    expect(rects.slice(21).map(({ box }) => box)).toEqual(segments);
    expect(rects.slice(21).every(({ color }) => color === HANDLE_FILL)).toBe(true);
  });

  it('counts rather than outlines a model that carries more outlines than the cap', () => {
    const box = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };
    const outlines = Array.from({ length: MAX_OUTLINED_OBJECTS + 1 }, () => box);
    const rects = overlayRectsOf({ ...SINGLE, outlines }, 1);
    expect(rects).toEqual(overlayRectsOf({ ...SINGLE, countBadge: MAX_OUTLINED_OBJECTS + 1 }, 1));
  });

  it('draws a locked selection above the cap with its count badge in the lock colour', () => {
    const rects = overlayRectsOf({ ...SINGLE, isLocked: true, countBadge: 600 }, 1);
    const { badge, segments } = countBadgeLayout(FRAME, 600, 1);
    // The frame's outline, the lock badge (5), then the count badge and its strokes.
    expect(rects).toHaveLength(4 + 5 + 1 + segments.length);
    expect(rects[9]).toEqual({ box: badge, color: LOCKED_COLOR });
    expect(rects.slice(10).every(({ color }) => color === HANDLE_FILL)).toBe(true);
  });

  it('outlines the entered group under everything else, in the half-strength colour', () => {
    const group = { x: -20, y: -20, width: 300, height: 200, rotation: 0.1 };
    const rects = overlayRectsOf({ ...SINGLE, enteredGroup: group }, 1);
    expect(rects).toHaveLength(4 + 4 + 16);
    expect(rects.slice(0, 4).every(({ color }) => color === ENTERED_GROUP_COLOR)).toBe(true);
    expect(rects.slice(4).some(({ color }) => color === ENTERED_GROUP_COLOR)).toBe(false);
    expect(rects[0]?.box).toMatchObject({ width: 302, height: 1, rotation: 0.1 });
    expect(ENTERED_GROUP_COLOR[3]).toBe(128 / 255);
  });

  it("draws the tool mode's rectangles last, as given, with or without a selection", () => {
    const caret = {
      box: { x: 5, y: 6, width: 0.5, height: 20, rotation: 0 },
      color: SELECTION_COLOR,
    };
    expect(overlayRectsOf({ ...EMPTY_OVERLAY, toolRects: [caret] }, 2)).toEqual([caret]);
    const rects = overlayRectsOf({ ...SINGLE, toolRects: [caret] }, 1);
    expect(rects).toHaveLength(4 + 16 + 1);
    expect(rects.at(-1)).toBe(caret);
  });
});

/** A shell palette, distinct values so each role can be told apart. */
const PALETTE: OverlayPalette = {
  you: [0.9, 0.66, 0.23, 1],
  guide: [0.88, 0.39, 0.35, 1],
  hover: [0.64, 0.64, 0.61, 1],
  locked: [0.42, 0.42, 0.4, 1],
};

describe('overlayRectsOf: the editing states', () => {
  it('outlines the hovered object one pixel wide, in the palette’s hover, under the selection', () => {
    const hover = { x: 400, y: 100, width: 50, height: 40, rotation: 0 };
    const rects = overlayRectsOf({ ...SINGLE, hover, palette: PALETTE }, 2);
    expect(rects).toHaveLength(4 + 4 + 16);
    expect(rects.slice(0, 4)).toEqual(outlineOf(hover, 0.5, PALETTE.hover));
    // Without a palette, the half-strength selection colour.
    const classic = overlayRectsOf({ ...EMPTY_OVERLAY, hover }, 1);
    expect(classic.every(({ color }) => color === ENTERED_GROUP_COLOR)).toBe(true);
  });

  it('draws the guides and gap runs in the palette’s guide colour, under the handles', () => {
    const guides = [{ axis: 'y', position: 100, from: 0, to: 400 }] as const;
    const gaps = [{ axis: 'x', from: 76, to: 100, position: 150 }] as const;
    const rects = overlayRectsOf({ ...SINGLE, guides, gaps, palette: PALETTE }, 1);
    expect(rects).toHaveLength(4 + 1 + 3 + 16);
    expect(rects.slice(4, 8).every(({ color }) => color === PALETTE.guide)).toBe(true);
    expect(rects.slice(5, 8)).toEqual(gapRunOf(gaps[0], 1, 1, PALETTE.guide));
    expect(rects.slice(8).some(({ color }) => color === PALETTE.guide)).toBe(false);
    // Without a palette, the guides' red.
    const classic = overlayRectsOf({ ...SINGLE, guides, gaps }, 1);
    expect(classic.slice(4, 8).every(({ color }) => color === SNAP_GUIDE_COLOR)).toBe(true);
  });

  it('outlines a locked selection dashed in the palette’s locked colour, badge kept, no handles', () => {
    const rects = overlayRectsOf({ ...SINGLE, isLocked: true, palette: PALETTE }, 1);
    const dashes = dashedOutlineOf(FRAME, 1, 1, PALETTE.locked);
    expect(rects).toEqual([
      ...dashes,
      ...overlayRectsOf({ ...SINGLE, isLocked: true }, 1).slice(4),
    ]);
    expect(dashes.length).toBeGreaterThan(4);
    expect(rects.slice(dashes.length)[0]?.color).toBe(LOCKED_COLOR);
  });

  it('leaves the labels to the shell: they draw no rectangle', () => {
    const labels = [{ kind: 'size', text: '200 × 100', at: { x: 300, y: 200 } }] as const;
    expect(overlayRectsOf({ ...SINGLE, labels }, 1)).toEqual(overlayRectsOf(SINGLE, 1));
  });
});

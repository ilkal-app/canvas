import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';

import type { OrientedBox } from './oriented-box.js';
import type { OverlayPalette } from './overlay-palette.js';
import { EMPTY_OVERLAY, overlayRectsOf } from './overlay-rects.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
const HAND: Rgba = [183 / 255, 128 / 255, 28 / 255, 1];
const FRAME_COLOR: Rgba = [169 / 255, 118 / 255, 26 / 255, 1];
const SHEET: Rgba = [243 / 255, 242 / 255, 238 / 255, 1];
const PALETTE: OverlayPalette = {
  you: HAND,
  guide: [0.8, 0.2, 0.1, 1],
  hover: [0.3, 0.4, 0.5, 1],
  locked: [0.5, 0.5, 0.5, 1],
  selection: { color: HAND, frameColor: FRAME_COLOR, handleFill: SHEET },
};

/**
 * The distinct colours among some rectangles.
 *
 * @param rects - The rectangles.
 * @returns Their colours, each once, as strings.
 */
function coloursOf(rects: readonly { readonly color: Rgba }[]): string[] {
  return [...new Set(rects.map(({ color }) => color.join(',')))];
}

describe('the floating selection frame colour', () => {
  it('draws the frame and the handle edges in frameColor, and nothing else in it', () => {
    const rects = overlayRectsOf(
      { ...EMPTY_OVERLAY, frame: FRAME, canResize: true, palette: PALETTE },
      1,
    );
    // The frame's four sides first, then the handles: edges in the frame colour, insides sheet.
    expect(coloursOf(rects.slice(0, 4))).toEqual([FRAME_COLOR.join(',')]);
    expect(coloursOf(rects)).toEqual([FRAME_COLOR.join(','), SHEET.join(',')]);
  });

  it('keeps hand/you for a multi-selection’s outlines, the marquee, the drop target and the insertion', () => {
    const second: OrientedBox = { x: 400, y: 100, width: 50, height: 50, rotation: 0 };
    const multi = overlayRectsOf(
      {
        ...EMPTY_OVERLAY,
        frame: FRAME,
        outlines: [FRAME, second],
        canResize: true,
        palette: PALETTE,
      },
      1,
    );
    expect(coloursOf(multi)).toContain(HAND.join(','));
    expect(coloursOf(multi)).toContain(FRAME_COLOR.join(','));
    const marks = overlayRectsOf(
      {
        ...EMPTY_OVERLAY,
        palette: PALETTE,
        marquee: { minX: 10, minY: 20, maxX: 50, maxY: 60 },
        dropTarget: second,
        insertion: { x: 0, y: 0, width: 0, height: 40, rotation: 0 },
      },
      1,
    );
    expect(coloursOf(marks)).not.toContain(FRAME_COLOR.join(','));
    expect(coloursOf(marks)).toContain(HAND.join(','));
  });
});

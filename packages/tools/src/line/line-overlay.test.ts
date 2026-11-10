import { describe, expect, it } from 'vitest';

import { HANDLE_FILL, SELECTION_COLOR } from '../select/overlay-rects.js';

import { ANCHOR_MARKER_PX, anchorMarkerRect, endpointHandleRects } from './line-overlay.js';

describe('endpointHandleRects', () => {
  it('draws a handle-sized square with a white inside, centred on the end, one screen size', () => {
    const [border, inside] = endpointHandleRects({ x: 100, y: 50 }, 2);
    expect(border).toEqual({
      box: { x: 98, y: 48, width: 4, height: 4, rotation: 0 },
      color: SELECTION_COLOR,
    });
    expect(inside).toEqual({
      box: { x: 98.5, y: 48.5, width: 3, height: 3, rotation: 0 },
      color: HANDLE_FILL,
    });
  });
});

describe('anchorMarkerRect', () => {
  it('fills a small square on the anchor', () => {
    const marker = anchorMarkerRect({ x: 0, y: 0 }, 1);
    expect(marker.box.width).toBe(ANCHOR_MARKER_PX);
    expect(marker.box.x).toBe(-ANCHOR_MARKER_PX / 2);
    expect(marker.color).toBe(SELECTION_COLOR);
  });
});

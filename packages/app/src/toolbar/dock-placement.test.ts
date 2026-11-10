import { describe, expect, it } from 'vitest';

import { dockPlacementOf, type DockFit } from './dock-placement.js';

/** The zoom control as it sits: 16 px in, 171 px wide (dock-zoom.spec.ts). */
const AT_REST: Omit<DockFit, 'canvasWidthPx' | 'dockWidthPx'> = {
  zoomRightPx: 16 + 171,
  insetPx: 16,
  gapPx: 8,
};

describe('dockPlacementOf', () => {
  it('centres the dock while that leaves the gap to the zoom control', () => {
    expect(dockPlacementOf({ ...AT_REST, canvasWidthPx: 1280, dockWidthPx: 690 })).toEqual({
      kind: 'centre',
    });
    // Exactly the gap: still centred.
    expect(dockPlacementOf({ ...AT_REST, canvasWidthPx: 390 + 600, dockWidthPx: 600 })).toEqual({
      kind: 'centre',
    });
  });

  it('puts it just right of the zoom control when centred it would cover it, if it fits', () => {
    expect(dockPlacementOf({ ...AT_REST, canvasWidthPx: 900, dockWidthPx: 602 })).toEqual({
      kind: 'beside',
      leftPx: 195,
    });
    // Up to the canvas's right margin.
    expect(
      dockPlacementOf({ ...AT_REST, canvasWidthPx: 195 + 600 + 16, dockWidthPx: 600 }),
    ).toEqual({ kind: 'beside', leftPx: 195 });
  });

  it('raises it a row above the zoom control when it does not fit beside it either', () => {
    expect(dockPlacementOf({ ...AT_REST, canvasWidthPx: 768, dockWidthPx: 690 })).toEqual({
      kind: 'above',
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import { worldPointerOf } from './world-pointer.js';

/** A camera at zoom 2 whose view starts at (100, 50) on the board. */
const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

describe('worldPointerOf', () => {
  it('maps the point and each trail sample to the board, keeping pressures', () => {
    const pointer = worldPointerOf(
      {
        kind: 'pointerMove',
        screen: { x: 40, y: 20 },
        isShiftPressed: false,
        isModPressed: false,
        pressure: 0.6,
        trail: [{ screen: { x: 0, y: 0 }, pressure: 0.2 }, { screen: { x: 20, y: 10 } }],
      },
      CAMERA,
    );
    expect(pointer).toEqual({
      kind: 'pointerMove',
      screen: { x: 40, y: 20 },
      world: { x: 120, y: 60 },
      isShiftPressed: false,
      isModPressed: false,
      pressure: 0.6,
      trail: [{ world: { x: 100, y: 50 }, pressure: 0.2 }, { world: { x: 110, y: 55 } }],
    });
  });

  it('adds no trail to an input without one', () => {
    const pointer = worldPointerOf(
      { kind: 'pointerDown', screen: { x: 0, y: 0 }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
    expect(pointer).not.toHaveProperty('trail');
    expect(pointer.world).toEqual({ x: 100, y: 50 });
  });
});

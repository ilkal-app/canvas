import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import {
  minimapFrame,
  minimapItems,
  panToCentre,
  toMap,
  toWorld,
  viewOf,
} from './minimap-layout.js';

const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 400,
  dpr: 1,
};

describe('the minimap layout', () => {
  it('reads the view a camera shows', () => {
    expect(viewOf(CAMERA)).toEqual({ x: 100, y: 50, width: 400, height: 200 });
  });

  it('draws sections as outlines, stickies in their colour, and the rest as blocks', () => {
    const object = (fields: Record<string, unknown>) => fields as unknown as BoardObject;
    const boundsOf = (value: BoardObject) =>
      value.type === 'group' ? undefined : { minX: 1, minY: 2, maxX: 4, maxY: 6 };
    expect(
      minimapItems(
        [
          object({ type: 'frame' }),
          object({ type: 'sticky', color: [1, 0.9, 0.5, 1] }),
          object({ type: 'sticky', color: { token: 'accent' } }),
          object({ type: 'group' }),
          object({ type: 'shape' }),
        ],
        boundsOf,
      ),
    ).toEqual([
      { x: 1, y: 2, width: 3, height: 4, kind: 'frame' },
      { x: 1, y: 2, width: 3, height: 4, kind: 'sticky', color: [1, 0.9, 0.5, 1] },
      { x: 1, y: 2, width: 3, height: 4, kind: 'sticky' },
      { x: 1, y: 2, width: 3, height: 4, kind: 'other' },
    ]);
  });

  it('fits the box around the objects and the view, with a margin, centred', () => {
    const view = { x: 0, y: 0, width: 100, height: 50 };
    const frame = minimapFrame([{ x: 300, y: 0, width: 100, height: 50 }], view, 216, 120);
    // The box is 400 × 50 plus 5% each side: 440 × 55; the map's width binds.
    expect(frame.world).toEqual({ x: -20, y: -2.5, width: 440, height: 55 });
    expect(frame.scale).toBeCloseTo(216 / 440);
    expect(frame.offsetX).toBeCloseTo(0);
    expect(frame.offsetY).toBeCloseTo((120 - 55 * (216 / 440)) / 2);
    const mapped = toMap(frame, view);
    const back = toWorld(frame, mapped.x, mapped.y);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
    expect(mapped.width).toBeCloseTo(100 * (216 / 440));
  });

  it('frames an empty page around the view alone', () => {
    const view = viewOf(CAMERA);
    const frame = minimapFrame([], view, 216, 120);
    const mapped = toMap(frame, view);
    expect(mapped.x).toBeGreaterThan(0);
    expect(mapped.x + mapped.width).toBeLessThan(216);
  });

  it('pans the view to centre on a point at the same zoom', () => {
    // The view's centre is (300, 150); to centre on (400, 100) the board moves 200 px left, 100 down.
    expect(panToCentre(CAMERA, { x: 400, y: 100 })).toEqual({ deltaXPx: -200, deltaYPx: 100 });
    expect(panToCentre(CAMERA, { x: 300, y: 150 })).toEqual({ deltaXPx: 0, deltaYPx: 0 });
  });
});

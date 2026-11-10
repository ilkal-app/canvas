import { describe, expect, it } from 'vitest';

import type { OrientedBox } from './oriented-box.js';
import { MIN_RESIZE_SIZE, resizeFrame } from './resize-frame.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

function expectBox(actual: OrientedBox, expected: OrientedBox): void {
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    expect(actual[key], key).toBeCloseTo(expected[key], 9);
  }
}

describe('resizeFrame', () => {
  it('moves the dragged corner and keeps the opposite one', () => {
    expectBox(resizeFrame(FRAME, 'se', { x: 40, y: 20 }, false), {
      ...FRAME,
      width: 240,
      height: 120,
    });
    expectBox(resizeFrame(FRAME, 'nw', { x: 40, y: 20 }, false), {
      ...FRAME,
      x: 140,
      y: 120,
      width: 160,
      height: 80,
    });
  });

  it('moves only the dragged edge', () => {
    expectBox(resizeFrame(FRAME, 'e', { x: 40, y: 999 }, false), { ...FRAME, width: 240 });
    expectBox(resizeFrame(FRAME, 'n', { x: 999, y: -30 }, false), {
      ...FRAME,
      y: 70,
      height: 130,
    });
  });

  it('resizes proportionally with Shift from a corner, by the larger of the two ratios', () => {
    // 240 / 200 = 1.2 wide, 110 / 100 = 1.1 high: both become 1.2.
    expectBox(resizeFrame(FRAME, 'se', { x: 40, y: 10 }, true), {
      ...FRAME,
      width: 240,
      height: 120,
    });
    // From the top-left corner the bottom-right stays put.
    expectBox(resizeFrame(FRAME, 'nw', { x: -40, y: 0 }, true), {
      ...FRAME,
      x: 60,
      y: 80,
      width: 240,
      height: 120,
    });
  });

  it('resizes proportionally with Shift from an edge, about the perpendicular centre line', () => {
    expectBox(resizeFrame(FRAME, 'e', { x: 100, y: 0 }, true), {
      ...FRAME,
      y: 75,
      width: 300,
      height: 150,
    });
    expectBox(resizeFrame(FRAME, 's', { x: 0, y: -50 }, true), {
      ...FRAME,
      x: 150,
      width: 100,
      height: 50,
    });
  });

  it('resizes a rotated frame along its own axes', () => {
    // A quarter turn clockwise: the frame's local +x is world +y.
    const turned: OrientedBox = { ...FRAME, rotation: Math.PI / 2 };
    const resized = resizeFrame(turned, 'e', { x: 0, y: 40 }, false);
    expectBox(resized, { ...turned, width: 240 });
    // Its "se" corner follows the pointer in the world.
    const nw = resizeFrame(turned, 'nw', { x: -10, y: 30 }, false);
    // Local delta (30, 10): the origin moves to world (100 − 10, 100 + 30).
    expectBox(nw, { ...turned, x: 90, y: 130, width: 170, height: 90 });
  });

  it('stops a dragged edge short of the opposite one', () => {
    const squashed = resizeFrame(FRAME, 'e', { x: -500, y: 0 }, false);
    expectBox(squashed, { ...FRAME, width: MIN_RESIZE_SIZE });
    const lifted = resizeFrame(FRAME, 'n', { x: 0, y: 500 }, false);
    expectBox(lifted, { ...FRAME, y: 200 - MIN_RESIZE_SIZE, height: MIN_RESIZE_SIZE });
  });

  it('keeps a frame thinner than the minimum from growing when pushed inward', () => {
    const thin: OrientedBox = { ...FRAME, width: 0 };
    expectBox(resizeFrame(thin, 'e', { x: -5, y: 0 }, false), thin);
    // Proportional resize of a zero-width frame scales the height alone.
    expectBox(resizeFrame(thin, 's', { x: 0, y: 50 }, true), { ...thin, height: 150 });
    // A point-sized frame has no ratio to keep: a corner drag sizes it freely.
    const point: OrientedBox = { ...FRAME, width: 0, height: 0 };
    expectBox(resizeFrame(point, 'se', { x: 30, y: 10 }, true), {
      ...point,
      width: 30,
      height: 10,
    });
  });

  it('keeps a given aspect from a corner: the larger box the dragged edges reach', () => {
    // The 200 × 100 frame of an image drawn at 4:3.
    expectBox(resizeFrame(FRAME, 'se', { x: 40, y: 0 }, true, 4 / 3), {
      ...FRAME,
      width: 240,
      height: 180,
    });
    // The bottom edge reaches further: 150 high takes 200 wide.
    expectBox(resizeFrame(FRAME, 'nw', { x: 0, y: -50 }, true, 4 / 3), {
      ...FRAME,
      x: 100,
      y: 50,
      width: 200,
      height: 150,
    });
    // Not proportional: the aspect is not kept.
    expectBox(resizeFrame(FRAME, 'se', { x: 40, y: 0 }, false, 4 / 3), { ...FRAME, width: 240 });
  });

  it('keeps a given aspect from an edge, the other side about the centre line', () => {
    expectBox(resizeFrame(FRAME, 'e', { x: 40, y: 0 }, true, 2), {
      ...FRAME,
      y: 90,
      width: 240,
      height: 120,
    });
    expectBox(resizeFrame(FRAME, 's', { x: 0, y: 50 }, true, 4 / 3), {
      ...FRAME,
      x: 100,
      width: 200,
      height: 150,
    });
  });

  it('keeps a given aspect along a turned frame’s own axes', () => {
    const turned: OrientedBox = { ...FRAME, rotation: Math.PI / 2 };
    // Along the frame's own x, world +y at a quarter turn: 40 wider, and 4:3.
    const resized = resizeFrame(turned, 'e', { x: 0, y: 40 }, true, 4 / 3);
    expect(resized.width).toBeCloseTo(240, 9);
    expect(resized.height).toBeCloseTo(180, 9);
    expect(resized.rotation).toBe(turned.rotation);
  });
});

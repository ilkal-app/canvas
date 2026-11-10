import { describe, expect, it } from 'vitest';

import { ROTATION_SNAP_STEP, rotationAngle } from './rotation-angle.js';

const PIVOT = { x: 0, y: 0 };
const DEGREE = Math.PI / 180;

describe('rotationAngle', () => {
  it('is the angle swept about the pivot from the press to the pointer, clockwise positive', () => {
    expect(rotationAngle(PIVOT, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    expect(rotationAngle(PIVOT, { x: 0, y: -10 }, { x: -10, y: 0 }, 0, false)).toBeCloseTo(
      -Math.PI / 2,
      12,
    );
  });

  it('takes the short way round across the half turn', () => {
    const from = { x: -10, y: 1 };
    const to = { x: -10, y: -1 };
    expect(rotationAngle(PIVOT, from, to, 0, false)).toBeCloseTo(2 * Math.atan2(1, 10), 12);
  });

  it('snaps with Shift so the frame ends on a multiple of 15°', () => {
    expect(ROTATION_SNAP_STEP).toBeCloseTo(15 * DEGREE, 15);
    const to = { x: Math.cos(22 * DEGREE), y: Math.sin(22 * DEGREE) };
    expect(rotationAngle(PIVOT, { x: 1, y: 0 }, to, 0, true)).toBeCloseTo(15 * DEGREE, 12);
    // A frame already turned 10°: 10° + 22° = 32° snaps to 30°, a turn of 20°.
    expect(rotationAngle(PIVOT, { x: 1, y: 0 }, to, 10 * DEGREE, true)).toBeCloseTo(
      20 * DEGREE,
      12,
    );
  });

  it('turns nothing when the pointer sits on the pivot', () => {
    expect(rotationAngle(PIVOT, { x: 5, y: 5 }, PIVOT, 0, false)).toBe(0);
  });
});

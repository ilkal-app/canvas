import { describe, expect, it } from 'vitest';

import { constrainLineEnd, LINE_ANGLE_STEP } from './angle-constraint.js';

describe('constrainLineEnd', () => {
  it('steps by 45°', () => {
    expect(LINE_ANGLE_STEP).toBeCloseTo(Math.PI / 4, 12);
  });

  it('turns a nearly horizontal end onto the horizontal, keeping its length', () => {
    const end = constrainLineEnd({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(end.x).toBeCloseTo(Math.hypot(100, 10), 9);
    expect(end.y).toBeCloseTo(0, 9);
  });

  it('turns an end near the diagonal onto it', () => {
    const end = constrainLineEnd({ x: 10, y: 10 }, { x: 60, y: 70 });
    expect(end.x - 10).toBeCloseTo(end.y - 10, 9);
    expect(Math.hypot(end.x - 10, end.y - 10)).toBeCloseTo(Math.hypot(50, 60), 9);
  });

  it('turns an end near the vertical onto it, above or below', () => {
    const up = constrainLineEnd({ x: 0, y: 0 }, { x: 3, y: -50 });
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeLessThan(0);
    const down = constrainLineEnd({ x: 0, y: 0 }, { x: -3, y: 50 });
    expect(down.x).toBeCloseTo(0, 9);
    expect(down.y).toBeGreaterThan(0);
  });

  it('leaves an end on the fixed end where it is', () => {
    expect(constrainLineEnd({ x: 4, y: 5 }, { x: 4, y: 5 })).toEqual({ x: 4, y: 5 });
  });
});

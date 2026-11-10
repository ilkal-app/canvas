import { describe, expect, it } from 'vitest';

import { constrain45 } from './constrain-45.js';

describe('constrain45', () => {
  it('turns onto the nearest 45° direction and keeps the distance', () => {
    const origin = { x: 10, y: 10 };
    const flat = constrain45(origin, { x: 110, y: 18 });
    expect(flat.y).toBeCloseTo(10, 9);
    expect(flat.x).toBeCloseTo(10 + Math.hypot(100, 8), 9);
    const diagonal = constrain45(origin, { x: 60, y: 55 });
    expect(diagonal.x - 10).toBeCloseTo(diagonal.y - 10, 9);
    expect(Math.hypot(diagonal.x - 10, diagonal.y - 10)).toBeCloseTo(Math.hypot(50, 45), 9);
    const up = constrain45(origin, { x: 12, y: -90 });
    expect(up.x).toBeCloseTo(10, 9);
    expect(up.y).toBeCloseTo(10 - Math.hypot(2, 100), 9);
  });

  it('gives the origin for a point on it', () => {
    expect(constrain45({ x: 3, y: 4 }, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

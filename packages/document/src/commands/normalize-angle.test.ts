import { describe, expect, it } from 'vitest';

import { normalizeAngle } from './normalize-angle.js';

describe('normalizeAngle', () => {
  it('leaves an angle in (−π, π] exactly as it is', () => {
    for (const angle of [0, -0.25, 3, Math.PI, -3]) expect(normalizeAngle(angle)).toBe(angle);
  });

  it('turns an angle that is not finite into 0, so a sum of two far stored angles is storable', () => {
    for (const angle of [Infinity, -Infinity, Number.NaN, -1e308 + -1e308]) {
      expect(normalizeAngle(angle)).toBe(0);
    }
  });

  it('wraps an angle of any size into (−π, π], however far past the doubles that count turns it is', () => {
    for (const angle of [1e16, -1e16, 1e300, -1e308, 2 ** 60, 7 * Math.PI, -7 * Math.PI]) {
      const wrapped = normalizeAngle(angle);
      expect(wrapped).toBeGreaterThan(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('wraps angles outside the range by whole turns, −π to π', () => {
    expect(normalizeAngle(3.4)).toBeCloseTo(3.4 - 2 * Math.PI, 12);
    expect(normalizeAngle(-3.4)).toBeCloseTo(2 * Math.PI - 3.4, 12);
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
  });
});

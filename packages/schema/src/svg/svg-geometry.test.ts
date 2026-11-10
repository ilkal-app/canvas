import { describe, expect, it } from 'vitest';

import { composeMaps, IDENTITY, invertMap } from './svg-geometry.js';

describe('composeMaps and invertMap', () => {
  it('inverts a map so that composing the two is the identity', () => {
    const map = { a: 2, b: 1, c: -1, d: 3, x: 5, y: -4 };
    const inverse = invertMap(map);
    expect(inverse).toBeDefined();
    const round = composeMaps(map, inverse ?? IDENTITY);
    for (const key of ['a', 'b', 'c', 'd', 'x', 'y'] as const) {
      expect(round[key]).toBeCloseTo(IDENTITY[key], 12);
    }
  });

  it('has no inverse for a singular or overflowing map', () => {
    expect(invertMap({ ...IDENTITY, d: 0 })).toBeUndefined();
    expect(invertMap({ ...IDENTITY, a: 1e200, d: 1e200 })).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { cubicToQuadratics, tessellateGlyph } from './glyph-geometry.js';

describe('tessellateGlyph', () => {
  it('skips an empty contour', () => {
    const geometry = tessellateGlyph({
      contours: [[], [{ kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 }]],
    });
    expect(geometry.vertexCount).toBe(3);
    expect(geometry.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 0 });
  });
});

describe('cubicToQuadratics', () => {
  const cubic = {
    kind: 'cubic',
    x0: 0,
    y0: 0,
    c1x: 0,
    c1y: 1,
    c2x: 1,
    c2y: -1,
    x1: 1,
    y1: 0,
  } as const;

  it('keeps a cubic that is a quadratic as one quadratic', () => {
    // Controls at 2/3 of a quadratic's control: the third difference is 0.
    const quadratic = cubicToQuadratics(
      { kind: 'cubic', x0: 0, y0: 0, c1x: 1 / 3, c1y: 2 / 3, c2x: 2 / 3, c2y: 2 / 3, x1: 1, y1: 0 },
      1 / 4096,
    );
    expect(quadratic).toHaveLength(1);
    expect(quadratic[0]?.[1][0]).toBeCloseTo(0.5, 12);
    expect(quadratic[0]?.[1][1]).toBeCloseTo(1, 12);
  });

  it('splits more finely for a tighter tolerance, up to 64 pieces, and survives a zero tolerance', () => {
    const coarse = cubicToQuadratics(cubic, 1 / 64).length;
    const fine = cubicToQuadratics(cubic, 1 / 4096).length;
    expect(fine).toBeGreaterThan(coarse);
    expect(cubicToQuadratics(cubic, 0)).toHaveLength(64);
    const pieces = cubicToQuadratics(cubic, 1 / 4096);
    expect(pieces[0]?.[0]).toEqual([0, 0]);
    expect(pieces.at(-1)?.[2][0]).toBeCloseTo(1, 12);
  });
});

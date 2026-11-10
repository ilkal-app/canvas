import { describe, expect, it } from 'vitest';

import { MAX_OUTLINE_SEGMENTS, OutlineBuilder } from './outline-builder.js';

describe('OutlineBuilder', () => {
  it('scales every kind of segment to em, each starting where the last ended', () => {
    const builder = new OutlineBuilder(1000);
    builder.moveTo(0, 0);
    builder.lineTo(500, 0);
    builder.quadraticTo(1000, 0, 1000, 500);
    builder.cubicTo(1000, 750, 750, 1000, 0, 1000);
    builder.lineTo(0, 0);
    builder.closePath();
    expect(builder.finish()).toEqual({
      contours: [
        [
          { kind: 'line', x0: 0, y0: 0, x1: 0.5, y1: 0 },
          { kind: 'quadratic', x0: 0.5, y0: 0, cx: 1, cy: 0, x1: 1, y1: 0.5 },
          { kind: 'cubic', x0: 1, y0: 0.5, c1x: 1, c1y: 0.75, c2x: 0.75, c2y: 1, x1: 0, y1: 1 },
          { kind: 'line', x0: 0, y0: 1, x1: 0, y1: 0 },
        ],
      ],
    });
  });

  it('closes a contour that ends away from its start, at a close, a move or the end', () => {
    const builder = new OutlineBuilder(1);
    builder.moveTo(0, 0);
    builder.lineTo(1, 0);
    builder.lineTo(1, 1);
    builder.moveTo(5, 5);
    builder.lineTo(6, 5);
    const outline = builder.finish();
    expect(outline.contours).toHaveLength(2);
    expect(outline.contours[0]?.at(-1)).toEqual({ kind: 'line', x0: 1, y0: 1, x1: 0, y1: 0 });
    expect(outline.contours[1]?.at(-1)).toEqual({ kind: 'line', x0: 6, y0: 5, x1: 5, y1: 5 });
  });

  it('starts a contour where the pen is when drawing begins without a move', () => {
    const builder = new OutlineBuilder(1);
    builder.lineTo(2, 0);
    builder.lineTo(2, 2);
    expect(builder.finish().contours[0]?.[0]).toEqual({ kind: 'line', x0: 0, y0: 0, x1: 2, y1: 0 });
  });

  it('keeps no empty contour for a lone move or a repeated close', () => {
    const builder = new OutlineBuilder(1);
    builder.moveTo(3, 3);
    builder.closePath();
    builder.closePath();
    expect(builder.finish()).toEqual({ contours: [] });
  });

  it('draws nothing past its segment limit, and nothing for a face without units per em', () => {
    const bounded = new OutlineBuilder(1, 3);
    bounded.moveTo(0, 0);
    bounded.lineTo(1, 0);
    bounded.lineTo(1, 1);
    bounded.lineTo(0, 1);
    bounded.lineTo(0, 0);
    expect(bounded.finish()).toEqual({ contours: [] });
    const unitless = new OutlineBuilder(0);
    unitless.moveTo(0, 0);
    unitless.lineTo(1, 0);
    expect(unitless.finish()).toEqual({ contours: [] });
    expect(MAX_OUTLINE_SEGMENTS).toBe(65_536);
  });
});

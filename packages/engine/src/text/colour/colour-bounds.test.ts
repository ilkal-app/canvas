import { describe, expect, it } from 'vitest';

import type { ColourGlyphOp } from '@canvas/text';

import { paintBounds } from './colour-bounds.js';
import { colourGlyphBox, MAX_OVERHANG_EM } from './colour-glyph-job.js';

const black = { r: 0, g: 0, b: 0, a: 1 };
const solid: ColourGlyphOp = { op: 'solid', color: black, isForeground: false };
const square = {
  contours: [
    [
      { kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 },
      { kind: 'quadratic', x0: 1, y0: 0, cx: 1.5, cy: 0.5, x1: 1, y1: 1 },
      { kind: 'cubic', x0: 1, y0: 1, c1x: 0.5, c1y: 1.2, c2x: 0.2, c2y: 1, x1: 0, y1: 1 },
    ],
  ],
} as const;

describe('paintBounds', () => {
  it('takes a clip rectangle through its transform', () => {
    expect(
      paintBounds({
        ops: [
          { op: 'push-transform', xx: 2, yx: 0, xy: 0, yy: 1, dx: 0.5, dy: 0 },
          { op: 'push-clip-rect', xMin: 0, yMin: 0, xMax: 1, yMax: 1.25 },
          solid,
          { op: 'pop-clip' },
          { op: 'pop-transform' },
        ],
      }),
    ).toEqual({ xMin: 0.5, yMin: 0, xMax: 2.5, yMax: 1.25 });
  });

  it('bounds a clip outline by its points, control points included, inside an outer clip', () => {
    expect(
      paintBounds({
        ops: [
          { op: 'push-clip-rect', xMin: -1, yMin: -1, xMax: 1.25, yMax: 3 },
          { op: 'push-clip-glyph', outline: square },
          solid,
        ],
      }),
    ).toEqual({ xMin: 0, yMin: 0, xMax: 1.25, yMax: 1.2 });
  });

  it('unions images and clipped fills, and ignores unclipped fills and empty clips', () => {
    expect(paintBounds({ ops: [solid] })).toBeUndefined();
    expect(
      paintBounds({
        ops: [
          { op: 'push-clip-glyph', outline: { contours: [] } },
          solid,
          { op: 'pop-clip' },
          { op: 'pop-clip' },
          { op: 'pop-transform' },
          { op: 'push-group' },
          {
            op: 'image',
            format: 'png',
            bytes: new Uint8Array(),
            width: 1,
            height: 1,
            xMin: -0.5,
            yMin: 0,
            xMax: 0,
            yMax: 1,
          },
          { op: 'pop-group', mode: 'src-over' },
        ],
      }),
    ).toEqual({ xMin: -0.5, yMin: 0, xMax: 0, yMax: 1 });
  });

  it('cuts an image by the clip around it', () => {
    expect(
      paintBounds({
        ops: [
          { op: 'push-clip-rect', xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
          {
            op: 'image',
            format: 'png',
            bytes: new Uint8Array(),
            width: 1,
            height: 1,
            xMin: 0.5,
            yMin: -1,
            xMax: 2,
            yMax: 0.5,
          },
        ],
      }),
    ).toEqual({ xMin: 0.5, yMin: 0, xMax: 1, yMax: 0.5 });
  });
});

describe('colourGlyphBox', () => {
  const metrics = { xMin: 0, yMin: -0.25, xMax: 1, yMax: 0.95 };

  it('keeps the metrics box when the paint is unbounded or inside it', () => {
    expect(colourGlyphBox(metrics, undefined)).toEqual(metrics);
    expect(colourGlyphBox(metrics, { xMin: 0.2, yMin: 0, xMax: 0.8, yMax: 0.5 })).toEqual(metrics);
  });

  it('widens to the paint, at most the overhang past the metrics', () => {
    expect(colourGlyphBox(metrics, { xMin: -5, yMin: -0.5, xMax: 1, yMax: 1 })).toEqual({
      xMin: -MAX_OVERHANG_EM,
      yMin: -0.5,
      xMax: 1,
      yMax: 1,
    });
  });
});

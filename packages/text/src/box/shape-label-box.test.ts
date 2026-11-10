import { describe, expect, it } from 'vitest';

import {
  polygonFitOf,
  starInnerRadius,
  unitPolygonInradius,
  unitPolygonVertex,
} from './polygon-fit.js';
import { labelPaddingOf, shapeLabelBox, shapeLabelWrapWidth } from './shape-label-box.js';

const shape = (kind: 'rectangle' | 'ellipse' | 'diamond' | 'polygon' | 'star', fields = {}) => ({
  kind,
  width: 200,
  height: 100,
  cornerRadius: 0,
  sides: 5,
  ...fields,
});

describe('shape label boxes', () => {
  it('uses a rectangle inset by its rounded corners', () => {
    expect(shapeLabelBox(shape('rectangle'))).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const inset = 20 * (1 - Math.SQRT1_2);
    expect(shapeLabelBox(shape('rectangle', { cornerRadius: 20 }))).toEqual({
      x: inset,
      y: inset,
      width: 200 - 2 * inset,
      height: 100 - 2 * inset,
    });
  });

  it('uses the rectangle inscribed in an ellipse', () => {
    const box = shapeLabelBox(shape('ellipse'));
    expect(box.width).toBeCloseTo(200 * Math.SQRT1_2);
    expect(box.x + box.width / 2).toBeCloseTo(100);
  });

  it('fits a wide box in a polygon, a diamond and a star, inside the shape', () => {
    for (const kind of ['diamond', 'polygon', 'star'] as const) {
      const box = shapeLabelBox(shape(kind));
      expect(box.width).toBeGreaterThan(0);
      expect(box.width).toBeLessThan(200);
      expect(box.x + box.width / 2).toBeCloseTo(100);
      expect(box.width).toBeGreaterThan(box.height);
    }
  });

  it('pads a box by at most 8 and at most 15% of its shorter side, and wraps inside it', () => {
    expect(labelPaddingOf({ x: 0, y: 0, width: 200, height: 100 })).toBe(8);
    expect(labelPaddingOf({ x: 0, y: 0, width: 20, height: 20 })).toBe(3);
    expect(shapeLabelWrapWidth(shape('rectangle'))).toBe(184);
    expect(shapeLabelWrapWidth(shape('rectangle', { width: 0 }))).toBe(1);
  });
});

describe('polygon fit', () => {
  it('puts a polygon’s first vertex at the top and fits its bounds to the box', () => {
    expect(unitPolygonVertex(0, 4, false)).toEqual({ x: 0, y: -1 });
    const fit = polygonFitOf({ x: 50, y: 50 }, 4, false);
    expect(fit.scale.x).toBeCloseTo(50);
    expect(fit.centre.y).toBeCloseTo(0);
  });

  it('keeps a star concave and measures the circle inside a polygon or star', () => {
    expect(starInnerRadius(5)).toBeCloseTo(0.5 * Math.cos(Math.PI / 5));
    expect(unitPolygonInradius(5, true)).toBeCloseTo(starInnerRadius(5));
    expect(unitPolygonInradius(4, false)).toBeCloseTo(Math.SQRT1_2);
  });
});
